const DEFAULT_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_REASON = 'session_expired';
const DEFAULT_REASON_PARAM = 'reason';
const DEFAULT_RETURN_URL_PARAM = 'returnUrl';
const DEFAULT_SIGN_IN_PATH = '/signin';
const DEFAULT_STATUS_PATH = '/oauth2/status';
const HTTP_UNAUTHORIZED = 401;

export type SessionExpiredContext = {
	returnTo: string;
	signInUrl: string;
};

export type SessionExpiryGuard = {
	check: () => Promise<boolean>;
	dispose: () => void;
};

export type SessionExpiryGuardConfig = {
	checkIntervalMs?: number;
	isProtectedRequest?: (url: URL) => boolean;
	onExpired?: (context: SessionExpiredContext) => void;
	protectedPaths?: readonly string[];
	reason?: string;
	reasonParam?: string;
	returnUrlParam?: string;
	signInPath?: string;
	statusPath?: string;
};

let activeGuard: SessionExpiryGuard | null = null;

const requestUrl = (input: RequestInfo | URL, origin: string) => {
	const raw = input instanceof Request ? input.url : String(input);

	try {
		return new URL(raw, origin);
	} catch {
		return null;
	}
};

export const buildSessionExpiredSignInUrl = ({
	currentHref,
	reason = DEFAULT_REASON,
	reasonParam = DEFAULT_REASON_PARAM,
	returnUrlParam = DEFAULT_RETURN_URL_PARAM,
	signInPath = DEFAULT_SIGN_IN_PATH
}: {
	currentHref: string;
	reason?: string;
	reasonParam?: string;
	returnUrlParam?: string;
	signInPath?: string;
}) => {
	const current = new URL(currentHref);
	const returnTo = `${current.pathname}${current.search}${current.hash}`;
	const destination = new URL(signInPath, current.origin);
	destination.searchParams.set(reasonParam, reason);
	destination.searchParams.set(returnUrlParam, returnTo);

	return destination.origin === current.origin
		? `${destination.pathname}${destination.search}${destination.hash}`
		: destination.toString();
};

/**
 * Installs one browser-wide session-expiry guard. It intercepts 401 responses
 * only for explicitly protected same-origin requests and rechecks the auth
 * status route when a backgrounded or bfcached page becomes active again.
 */
export const installSessionExpiryGuard = (
	config: SessionExpiryGuardConfig = {}
) => {
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		return { check: async () => false, dispose: () => undefined };
	}
	if (activeGuard) return activeGuard;

	const {
		checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
		isProtectedRequest,
		onExpired,
		protectedPaths = [],
		reason = DEFAULT_REASON,
		reasonParam = DEFAULT_REASON_PARAM,
		returnUrlParam = DEFAULT_RETURN_URL_PARAM,
		signInPath = DEFAULT_SIGN_IN_PATH,
		statusPath = DEFAULT_STATUS_PATH
	} = config;
	const nativeFetch = window.fetch.bind(window);
	const originalFetch = window.fetch;
	let checking = false;
	let disposed = false;
	let expired = false;
	let lastCheckedAt = Date.now();

	const expire = () => {
		if (expired || disposed) return;
		expired = true;
		const currentHref = window.location.href;
		const signInUrl = buildSessionExpiredSignInUrl({
			currentHref,
			reason,
			reasonParam,
			returnUrlParam,
			signInPath
		});
		const current = new URL(currentHref);
		const returnTo = `${current.pathname}${current.search}${current.hash}`;
		if (onExpired) {
			onExpired({ returnTo, signInUrl });

			return;
		}
		window.location.assign(signInUrl);
	};

	const protectedRequest = (input: RequestInfo | URL) => {
		const url = requestUrl(input, window.location.origin);
		if (!url || url.origin !== window.location.origin) return false;
		if (
			new URL(statusPath, window.location.origin).pathname ===
			url.pathname
		)
			return false;

		return (
			isProtectedRequest?.(url) === true ||
			protectedPaths.some((path) => url.pathname.startsWith(path))
		);
	};

	const guardedFetch = new Proxy(originalFetch, {
		apply: async (target, thisArg, args) => {
			const [input] = args;
			const response = await Reflect.apply(target, thisArg, args);
			if (
				response.status === HTTP_UNAUTHORIZED &&
				protectedRequest(input)
			) {
				expire();
			}

			return response;
		}
	});
	window.fetch = guardedFetch;

	const check = async () => {
		if (checking || expired || disposed) return false;
		checking = true;
		lastCheckedAt = Date.now();
		try {
			const response = await nativeFetch(statusPath, {
				cache: 'no-store',
				credentials: 'include',
				headers: { accept: 'application/json' }
			});
			if (!response.ok) return false;
			const payload: unknown = await response.json();
			const sessionExpired =
				typeof payload === 'object' &&
				payload !== null &&
				Reflect.get(payload, 'user') === null;
			if (!sessionExpired) return false;
			expire();

			return true;
		} catch {
			// A connectivity failure is not proof that the session expired.
			return false;
		} finally {
			checking = false;
		}
	};

	const checkIfDue = () => {
		if (
			document.visibilityState !== 'visible' ||
			Date.now() - lastCheckedAt < checkIntervalMs
		)
			return;
		void check();
	};
	const checkPersistedSession = (event: PageTransitionEvent) => {
		if (!event.persisted) return;
		void check();
	};
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		document.removeEventListener('visibilitychange', checkIfDue);
		window.removeEventListener('focus', checkIfDue);
		window.removeEventListener('pageshow', checkPersistedSession);
		if (window.fetch === guardedFetch) window.fetch = originalFetch;
		activeGuard = null;
	};

	document.addEventListener('visibilitychange', checkIfDue);
	window.addEventListener('focus', checkIfDue);
	window.addEventListener('pageshow', checkPersistedSession);
	activeGuard = { check, dispose };

	return activeGuard;
};

export const isProtectedSessionRequest = ({
	input,
	origin,
	protectedPaths
}: {
	input: RequestInfo | URL;
	origin: string;
	protectedPaths: readonly string[];
}) => {
	const url = requestUrl(input, origin);

	return (
		url?.origin === origin &&
		protectedPaths.some((path) => url.pathname.startsWith(path))
	);
};
