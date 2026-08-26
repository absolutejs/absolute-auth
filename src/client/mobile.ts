import {
	deriveAuthSyncNamespace,
	readAuthSyncPartition
} from '../syncNamespace';

export type MobileAuthSecureStorage = {
	capability?: () => Promise<{
		available: boolean;
		message?: string;
	}>;
	get(key: string): Promise<string | null>;
	remove(key: string): Promise<void>;
	set(key: string, value: string): Promise<void>;
	/** Serialize refresh-token rotation with a native background worker. */
	withLock?<T>(key: string, run: () => Promise<T>): Promise<T>;
};

export type MobileAuthLinks = {
	getLaunchUrl(): Promise<string | null>;
	onOpen(
		listener: (url: string) => void
	): Promise<() => Promise<void> | void>;
	openExternal(url: string): Promise<void>;
};

export type MobileAuthLifecycle = {
	onResume?(listener: () => void): Promise<() => Promise<void> | void>;
};

export type MobileAuthDiscovery = {
	authorization_endpoint: string;
	code_challenge_methods_supported?: string[];
	issuer: string;
	jwks_uri: string;
	revocation_endpoint?: string;
	socket_ticket_endpoint?: string;
	token_endpoint: string;
	token_endpoint_auth_methods_supported?: string[];
	userinfo_endpoint: string;
};

export type MobileAuthClientConfig = {
	allowedOrigins?: readonly string[];
	/** Runs while renewable credentials still exist, before native sign-out. */
	beforeSignOut?: () => Promise<void> | void;
	clientId: string;
	clockSkewMs?: number;
	fetch?: typeof globalThis.fetch;
	issuer: string;
	lifecycle?: MobileAuthLifecycle;
	links: MobileAuthLinks;
	now?: () => number;
	redirectUri: string;
	resource?: string;
	scopes?: readonly string[];
	storage: MobileAuthSecureStorage;
};

export type MobileAuthSignInOptions = {
	authorizationParameters?: Readonly<Record<string, string>>;
	signal?: AbortSignal;
};

export type MobileAuthTokens = {
	accessToken: string;
	expiresAt: number;
	idToken: string;
	refreshToken: string;
	scope: string[];
	tokenType: 'Bearer';
};

export type MobileAuthUser = Record<string, unknown> & { sub: string };

export type MobileAuthPrincipal = {
	issuer: string;
	namespace: string;
	/** Optional server-owned tenant/account partition from userinfo. */
	partition?: string;
	subject: string;
};

export type MobileAuthErrorCode =
	| 'aborted'
	| 'callback'
	| 'discovery'
	| 'id-token'
	| 'network'
	| 'oauth'
	| 'origin'
	| 'secure-storage'
	| 'token';

export class MobileAuthError extends Error {
	readonly code: MobileAuthErrorCode;
	readonly cause?: unknown;

	constructor(
		code: MobileAuthErrorCode,
		message: string,
		options?: { cause?: unknown }
	) {
		super(message);
		this.name = 'MobileAuthError';
		this.code = code;
		this.cause = options?.cause;
	}
}

type PendingAuthorization = {
	createdAt: number;
	nonce: string;
	state: string;
	verifier: string;
};

type TokenResponse = {
	access_token: string;
	expires_in: number;
	id_token: string;
	refresh_token: string;
	scope?: string;
	token_type: string;
};

type DeferredSignIn = {
	reject: (error: unknown) => void;
	resolve: (tokens: MobileAuthTokens) => void;
};

const PENDING_KEY = 'oidc.pending';
const REFRESH_KEY = 'oidc.refresh';
const DEFAULT_CLOCK_SKEW_MS = 30_000;
const PENDING_TTL_MS = 10 * 60_000;
const RANDOM_BYTES = 32;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const base64Url = (value: Uint8Array) => {
	let binary = '';
	for (const byte of value) binary += String.fromCharCode(byte);

	return btoa(binary)
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/u, '');
};

const decodeBase64Url = (value: string) => {
	const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
	const padded = normalized.padEnd(
		normalized.length + ((4 - (normalized.length % 4)) % 4),
		'='
	);
	const binary = atob(padded);

	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const randomValue = () => {
	const value = new Uint8Array(RANDOM_BYTES);
	crypto.getRandomValues(value);

	return base64Url(value);
};

const pkceChallenge = async (verifier: string) =>
	base64Url(
		new Uint8Array(
			await crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(verifier)
			)
		)
	);

const normalizeIssuer = (value: string) => {
	const issuer = new URL(value);
	const loopback =
		issuer.protocol === 'http:' &&
		['127.0.0.1', '[::1]', 'localhost'].includes(issuer.hostname);
	if (issuer.protocol !== 'https:' && !loopback)
		throw new TypeError('Mobile auth issuer must use HTTPS.');
	if (issuer.username || issuer.password || issuer.search || issuer.hash)
		throw new TypeError(
			'Mobile auth issuer cannot contain credentials, query, or fragment.'
		);
	issuer.pathname = issuer.pathname.replace(/\/$/u, '');

	return issuer.href.replace(/\/$/u, '');
};

const exactRedirect = (actualValue: string, expectedValue: string) => {
	const actual = new URL(actualValue);
	const expected = new URL(expectedValue);

	return (
		actual.protocol === expected.protocol &&
		actual.host === expected.host &&
		actual.pathname === expected.pathname &&
		actual.username === '' &&
		actual.password === ''
	);
};

const parsePending = (value: string | null) => {
	if (value === null) return undefined;
	try {
		const parsed: unknown = JSON.parse(value);
		if (
			!isRecord(parsed) ||
			typeof parsed.createdAt !== 'number' ||
			typeof parsed.nonce !== 'string' ||
			typeof parsed.state !== 'string' ||
			typeof parsed.verifier !== 'string'
		)
			return undefined;

		return {
			createdAt: parsed.createdAt,
			nonce: parsed.nonce,
			state: parsed.state,
			verifier: parsed.verifier
		} satisfies PendingAuthorization;
	} catch {
		return undefined;
	}
};

const parseTokenResponse = (value: unknown) => {
	if (
		!isRecord(value) ||
		typeof value.access_token !== 'string' ||
		typeof value.expires_in !== 'number' ||
		!Number.isFinite(value.expires_in) ||
		value.expires_in <= 0 ||
		typeof value.id_token !== 'string' ||
		typeof value.refresh_token !== 'string' ||
		typeof value.token_type !== 'string'
	)
		throw new MobileAuthError('token', 'The token response is malformed.');
	if (value.token_type.toLowerCase() !== 'bearer')
		throw new MobileAuthError(
			'token',
			`Unsupported mobile token type ${value.token_type}; DPoP is not enabled for this client.`
		);

	return {
		access_token: value.access_token,
		expires_in: value.expires_in,
		id_token: value.id_token,
		refresh_token: value.refresh_token,
		scope: typeof value.scope === 'string' ? value.scope : undefined,
		token_type: value.token_type
	} satisfies TokenResponse;
};

const responseBody = async (response: Response) => {
	const text = await response.text();
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
};

const requireEndpoint = (value: unknown, name: string, issuer: string) => {
	if (typeof value !== 'string')
		throw new MobileAuthError(
			'discovery',
			`OIDC discovery is missing ${name}.`
		);
	const endpoint = new URL(value);
	if (endpoint.protocol !== 'https:' && new URL(issuer).protocol === 'https:')
		throw new MobileAuthError(
			'discovery',
			`OIDC discovery ${name} must use HTTPS.`
		);

	return endpoint.href;
};

const parseDiscovery = (
	value: unknown,
	issuer: string
): MobileAuthDiscovery => {
	if (!isRecord(value) || value.issuer !== issuer)
		throw new MobileAuthError(
			'discovery',
			'OIDC discovery issuer does not match the configured issuer.'
		);
	const methods = Array.isArray(value.code_challenge_methods_supported)
		? value.code_challenge_methods_supported.filter(
				(method): method is string => typeof method === 'string'
			)
		: undefined;
	if (!methods?.includes('S256'))
		throw new MobileAuthError(
			'discovery',
			'OIDC provider does not advertise S256 PKCE.'
		);
	const authMethods = Array.isArray(
		value.token_endpoint_auth_methods_supported
	)
		? value.token_endpoint_auth_methods_supported.filter(
				(method): method is string => typeof method === 'string'
			)
		: undefined;
	if (!authMethods?.includes('none'))
		throw new MobileAuthError(
			'discovery',
			'OIDC provider does not accept public clients at the token endpoint.'
		);

	return {
		authorization_endpoint: requireEndpoint(
			value.authorization_endpoint,
			'authorization_endpoint',
			issuer
		),
		code_challenge_methods_supported: methods,
		issuer,
		jwks_uri: requireEndpoint(value.jwks_uri, 'jwks_uri', issuer),
		revocation_endpoint:
			typeof value.revocation_endpoint === 'string'
				? requireEndpoint(
						value.revocation_endpoint,
						'revocation_endpoint',
						issuer
					)
				: undefined,
		socket_ticket_endpoint:
			typeof value.socket_ticket_endpoint === 'string'
				? requireEndpoint(
						value.socket_ticket_endpoint,
						'socket_ticket_endpoint',
						issuer
					)
				: undefined,
		token_endpoint: requireEndpoint(
			value.token_endpoint,
			'token_endpoint',
			issuer
		),
		token_endpoint_auth_methods_supported: authMethods,
		userinfo_endpoint: requireEndpoint(
			value.userinfo_endpoint,
			'userinfo_endpoint',
			issuer
		)
	};
};

const verifyIdToken = async ({
	clientId,
	fetchImpl,
	idToken,
	issuer,
	jwksUri,
	nonce,
	now
}: {
	clientId: string;
	fetchImpl: typeof globalThis.fetch;
	idToken: string;
	issuer: string;
	jwksUri: string;
	nonce: string;
	now: number;
}) => {
	const [encodedHeader, encodedPayload, encodedSignature, ...extra] =
		idToken.split('.');
	if (!encodedHeader || !encodedPayload || !encodedSignature || extra.length)
		throw new MobileAuthError('id-token', 'The ID token is malformed.');
	let header: unknown;
	let payload: unknown;
	try {
		header = JSON.parse(
			new TextDecoder().decode(decodeBase64Url(encodedHeader))
		);
		payload = JSON.parse(
			new TextDecoder().decode(decodeBase64Url(encodedPayload))
		);
	} catch (cause) {
		throw new MobileAuthError('id-token', 'The ID token is malformed.', {
			cause
		});
	}
	if (
		!isRecord(header) ||
		header.alg !== 'ES256' ||
		typeof header.kid !== 'string' ||
		!isRecord(payload)
	)
		throw new MobileAuthError(
			'id-token',
			'The ID token header or claims are invalid.'
		);
	const response = await fetchImpl(jwksUri, { cache: 'no-store' });
	if (!response.ok)
		throw new MobileAuthError(
			'network',
			'Unable to fetch OIDC signing keys.'
		);
	const body: unknown = await response.json();
	const keys = isRecord(body) && Array.isArray(body.keys) ? body.keys : [];
	const jwk = keys.find(
		(candidate): candidate is JsonWebKey & { kid: string } =>
			isRecord(candidate) && candidate.kid === header.kid
	);
	if (!jwk)
		throw new MobileAuthError(
			'id-token',
			'The ID token signing key is unknown.'
		);
	const key = await crypto.subtle.importKey(
		'jwk',
		jwk,
		{ hash: 'SHA-256', name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['verify']
	);
	const valid = await crypto.subtle.verify(
		{ hash: 'SHA-256', name: 'ECDSA' },
		key,
		decodeBase64Url(encodedSignature),
		new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
	);
	const audience = payload.aud;
	if (
		!valid ||
		payload.iss !== issuer ||
		!(
			audience === clientId ||
			(Array.isArray(audience) && audience.includes(clientId))
		) ||
		payload.nonce !== nonce ||
		typeof payload.exp !== 'number' ||
		payload.exp * 1000 <= now
	)
		throw new MobileAuthError(
			'id-token',
			'The ID token signature or claims are invalid.'
		);
};

export const createMobileAuthClient = (config: MobileAuthClientConfig) => {
	const issuer = normalizeIssuer(config.issuer);
	const redirectUri = new URL(config.redirectUri).href;
	const fetchImpl = config.fetch ?? globalThis.fetch;
	const now = config.now ?? Date.now;
	const clockSkewMs = config.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
	const scopes = [...new Set(config.scopes ?? ['openid', 'profile'])];
	const resource = config.resource ?? issuer;
	if (!scopes.includes('openid')) scopes.unshift('openid');
	const allowedOrigins = new Set(
		(config.allowedOrigins ?? [new URL(issuer).origin]).map(
			(value) => new URL(value).origin
		)
	);
	let discoveryPromise: Promise<MobileAuthDiscovery> | undefined;
	let access: Omit<MobileAuthTokens, 'refreshToken'> | undefined;
	let refreshPromise: Promise<string> | undefined;
	let stopLinks: (() => Promise<void> | void) | undefined;
	let stopResume: (() => Promise<void> | void) | undefined;
	let startPromise: Promise<void> | undefined;
	const pendingSignIns = new Map<string, DeferredSignIn>();
	let currentPrincipal: MobileAuthPrincipal | null | undefined;
	const principalListeners = new Set<
		(principal: MobileAuthPrincipal | null) => void
	>();
	const publishPrincipal = (principal: MobileAuthPrincipal | null) => {
		if (
			currentPrincipal !== undefined &&
			currentPrincipal?.namespace === principal?.namespace
		)
			return;
		currentPrincipal = principal;
		for (const listener of principalListeners) listener(principal);
	};
	const principalFor = async (
		user: MobileAuthUser
	): Promise<MobileAuthPrincipal> => {
		const partition = readAuthSyncPartition(user);

		return {
			issuer,
			namespace: await deriveAuthSyncNamespace({
				clientId: config.clientId,
				issuer,
				partition,
				subject: user.sub
			}),
			...(partition === undefined ? {} : { partition }),
			subject: user.sub
		};
	};

	const fetchDiscovery = async () => {
		const url = new URL('/.well-known/openid-configuration', `${issuer}/`);
		const response = await fetchImpl(url, {
			cache: 'no-store',
			headers: { accept: 'application/json' }
		});
		if (!response.ok)
			throw new MobileAuthError(
				'discovery',
				`OIDC discovery failed with HTTP ${response.status}.`
			);

		return parseDiscovery(await response.json(), issuer);
	};

	const discovery = () => {
		discoveryPromise ??= fetchDiscovery();

		return discoveryPromise;
	};

	const assertSecureStorage = async () => {
		const capability = await config.storage.capability?.();
		if (capability && !capability.available)
			throw new MobileAuthError(
				'secure-storage',
				capability.message ??
					'Native secure credential storage is unavailable.'
			);
	};

	const tokenRequest = async (
		metadata: MobileAuthDiscovery,
		body: URLSearchParams,
		nonce?: string
	) => {
		let response: Response;
		try {
			response = await fetchImpl(metadata.token_endpoint, {
				body,
				credentials: 'omit',
				headers: {
					accept: 'application/json',
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST'
			});
		} catch (cause) {
			throw new MobileAuthError('network', 'The token request failed.', {
				cause
			});
		}
		const value = await responseBody(response);
		if (!response.ok) {
			const oauthCode =
				isRecord(value) && typeof value.error === 'string'
					? value.error
					: `HTTP ${response.status}`;
			throw new MobileAuthError(
				'oauth',
				`The authorization server rejected the token request (${oauthCode}).`
			);
		}
		const tokens = parseTokenResponse(value);
		if (nonce)
			await verifyIdToken({
				clientId: config.clientId,
				fetchImpl,
				idToken: tokens.id_token,
				issuer,
				jwksUri: metadata.jwks_uri,
				nonce,
				now: now()
			});

		return tokens;
	};

	const acceptTokens = async (
		tokens: TokenResponse
	): Promise<MobileAuthTokens> => {
		try {
			await config.storage.set(REFRESH_KEY, tokens.refresh_token);
		} catch (cause) {
			access = undefined;
			await config.storage.remove(REFRESH_KEY).catch(() => undefined);
			throw new MobileAuthError(
				'secure-storage',
				'The rotated refresh credential could not be saved securely.',
				{ cause }
			);
		}
		access = {
			accessToken: tokens.access_token,
			expiresAt: now() + tokens.expires_in * 1000,
			idToken: tokens.id_token,
			scope: tokens.scope?.split(' ').filter(Boolean) ?? scopes,
			tokenType: 'Bearer'
		};

		return { ...access, refreshToken: tokens.refresh_token };
	};

	const rotateAccessToken = async () => {
		await assertSecureStorage();
		const exchange = async () => {
			const refreshToken = await config.storage.get(REFRESH_KEY);
			if (!refreshToken)
				throw new MobileAuthError(
					'token',
					'This app has no renewable mobile session.'
				);
			const metadata = await discovery();
			const body = new URLSearchParams({
				client_id: config.clientId,
				grant_type: 'refresh_token',
				refresh_token: refreshToken
			});
			body.set('resource', resource);
			const tokens = await tokenRequest(metadata, body);

			return (await acceptTokens(tokens)).accessToken;
		};

		return config.storage.withLock
			? config.storage.withLock(REFRESH_KEY, exchange)
			: exchange();
	};

	const refreshAccessToken = async () => {
		if (access && access.expiresAt - clockSkewMs > now())
			return access.accessToken;
		if (refreshPromise) return refreshPromise;
		refreshPromise = rotateAccessToken().finally(() => {
			refreshPromise = undefined;
		});

		return refreshPromise;
	};

	const handleCallback = async (value: string) => {
		if (!exactRedirect(value, redirectUri))
			throw new MobileAuthError(
				'callback',
				'The authorization callback does not match this app registration.'
			);
		const url = new URL(value);
		const pending = parsePending(await config.storage.get(PENDING_KEY));
		if (!pending || now() - pending.createdAt > PENDING_TTL_MS) {
			await config.storage.remove(PENDING_KEY).catch(() => undefined);
			throw new MobileAuthError(
				'callback',
				'The authorization transaction is missing or expired.'
			);
		}
		const deferred = pendingSignIns.get(pending.state);
		const reject = (error: unknown) => {
			pendingSignIns.delete(pending.state);
			void config.storage.remove(PENDING_KEY);
			deferred?.reject(error);
			throw error;
		};
		if (url.searchParams.get('state') !== pending.state)
			return reject(
				new MobileAuthError(
					'callback',
					'The authorization callback state does not match.'
				)
			);
		if (url.searchParams.get('iss') !== issuer)
			return reject(
				new MobileAuthError(
					'callback',
					'The authorization callback issuer does not match.'
				)
			);
		const oauthError = url.searchParams.get('error');
		if (oauthError) {
			await config.storage.remove(PENDING_KEY);

			return reject(
				new MobileAuthError(
					'oauth',
					`Authorization failed (${oauthError}).`
				)
			);
		}
		const code = url.searchParams.get('code');
		if (!code)
			return reject(
				new MobileAuthError(
					'callback',
					'The authorization callback contains no code.'
				)
			);
		await config.storage.remove(PENDING_KEY);
		try {
			const metadata = await discovery();
			const body = new URLSearchParams({
				client_id: config.clientId,
				code,
				code_verifier: pending.verifier,
				grant_type: 'authorization_code',
				redirect_uri: redirectUri
			});
			body.set('resource', resource);
			const tokens = await acceptTokens(
				await tokenRequest(metadata, body, pending.nonce)
			);
			pendingSignIns.delete(pending.state);
			deferred?.resolve(tokens);

			return tokens;
		} catch (error) {
			return reject(error);
		}
	};

	const initialize = async () => {
		await assertSecureStorage();
		stopLinks = await config.links.onOpen((url) => {
			if (exactRedirect(url, redirectUri))
				void handleCallback(url).catch(() => undefined);
		});
		if (config.lifecycle?.onResume)
			stopResume = await config.lifecycle.onResume(() => {
				void refreshAccessToken().catch(() => undefined);
			});
		const launchUrl = await config.links.getLaunchUrl();
		if (launchUrl && exactRedirect(launchUrl, redirectUri))
			await handleCallback(launchUrl);
	};

	const start = () => {
		startPromise ??= initialize();

		return startPromise;
	};

	const signIn = async (options: MobileAuthSignInOptions = {}) => {
		await start();
		if (options.signal?.aborted)
			throw new MobileAuthError(
				'aborted',
				'Authorization was cancelled.'
			);
		const metadata = await discovery();
		const pending: PendingAuthorization = {
			createdAt: now(),
			nonce: randomValue(),
			state: randomValue(),
			verifier: randomValue()
		};
		await config.storage.set(PENDING_KEY, JSON.stringify(pending));
		const url = new URL(metadata.authorization_endpoint);
		url.search = new URLSearchParams({
			client_id: config.clientId,
			code_challenge: await pkceChallenge(pending.verifier),
			code_challenge_method: 'S256',
			nonce: pending.nonce,
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: scopes.join(' '),
			state: pending.state,
			...options.authorizationParameters
		}).toString();
		url.searchParams.set('resource', resource);
		const result = new Promise<MobileAuthTokens>((resolve, reject) => {
			pendingSignIns.set(pending.state, { reject, resolve });
			options.signal?.addEventListener(
				'abort',
				() => {
					pendingSignIns.delete(pending.state);
					void config.storage.remove(PENDING_KEY);
					reject(
						new MobileAuthError(
							'aborted',
							'Authorization was cancelled.'
						)
					);
				},
				{ once: true }
			);
		});
		try {
			await config.links.openExternal(url.href);
		} catch (error) {
			pendingSignIns.delete(pending.state);
			await config.storage.remove(PENDING_KEY);
			throw error;
		}

		return result;
	};

	const authenticatedFetch = async (
		input: RequestInfo | URL,
		init?: RequestInit
	) => {
		const original = new Request(input, init);
		if (!allowedOrigins.has(new URL(original.url).origin))
			throw new MobileAuthError(
				'origin',
				'Mobile auth refused to send a credential to an unregistered origin.'
			);
		const send = async (forceRefresh: boolean) => {
			if (forceRefresh) access = undefined;
			const token = await refreshAccessToken();
			const request = original.clone();
			const headers = new Headers(request.headers);
			headers.set('authorization', `Bearer ${token}`);

			return fetchImpl(
				new Request(request, { credentials: 'omit', headers })
			);
		};
		const response = await send(false);

		return response.status === 401 ? send(true) : response;
	};

	const optionalAuthenticatedFetch = async (
		input: RequestInfo | URL,
		init?: RequestInit
	) => {
		const request = new Request(input, init);
		if (!allowedOrigins.has(new URL(request.url).origin))
			throw new MobileAuthError(
				'origin',
				'Mobile auth refused to send a request outside an allowed origin.'
			);
		const refreshToken = await config.storage.get(REFRESH_KEY);
		if (access || refreshToken) return authenticatedFetch(request);

		return fetchImpl(new Request(request, { credentials: 'omit' }));
	};
	const signedOut = () => {
		publishPrincipal(null);

		return null;
	};

	const status = async () => {
		try {
			const metadata = await discovery();
			const response = await authenticatedFetch(
				metadata.userinfo_endpoint
			);
			if (response.status === 401) return signedOut();
			if (!response.ok)
				throw new MobileAuthError(
					'network',
					`User info failed with HTTP ${response.status}.`
				);
			const user: unknown = await response.json();
			if (!isRecord(user) || typeof user.sub !== 'string')
				throw new MobileAuthError(
					'token',
					'The user-info response is malformed.'
				);

			const normalized = {
				...user,
				sub: user.sub
			} satisfies MobileAuthUser;
			publishPrincipal(await principalFor(normalized));

			return normalized;
		} catch (error) {
			if (
				!(
					error instanceof MobileAuthError &&
					(error.code === 'oauth' || error.code === 'token')
				)
			)
				throw error;

			return signedOut();
		}
	};

	const socketTicket = async (audience = resource) => {
		const metadata = await discovery();
		if (!metadata.socket_ticket_endpoint)
			throw new MobileAuthError(
				'discovery',
				'The authorization server does not advertise WebSocket tickets.'
			);
		const response = await authenticatedFetch(
			metadata.socket_ticket_endpoint,
			{
				body: JSON.stringify({ audience }),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			}
		);
		const body: unknown = await responseBody(response);
		if (!response.ok || !isRecord(body) || typeof body.ticket !== 'string')
			throw new MobileAuthError(
				response.ok ? 'token' : 'oauth',
				`WebSocket ticket request failed with HTTP ${response.status}.`
			);

		return body.ticket;
	};

	const revokeRefreshToken = async (refreshToken: string) => {
		const metadata = await discovery();
		if (metadata.revocation_endpoint)
			await fetchImpl(metadata.revocation_endpoint, {
				body: new URLSearchParams({
					client_id: config.clientId,
					token: refreshToken,
					token_type_hint: 'refresh_token'
				}),
				credentials: 'omit',
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST'
			});
	};
	const runBeforeSignOut = async () => {
		try {
			await config.beforeSignOut?.();
		} catch {
			// Sign-out must remain available. Native integrations fail closed
			// locally and stale provider registrations retire on send.
		}
	};

	const signOut = async () => {
		const refreshToken = await config.storage.get(REFRESH_KEY);
		try {
			await runBeforeSignOut();
			if (refreshToken) await revokeRefreshToken(refreshToken);
		} finally {
			access = undefined;
			await Promise.all([
				config.storage.remove(PENDING_KEY),
				config.storage.remove(REFRESH_KEY)
			]);
			publishPrincipal(null);
		}
	};

	const principal = async () => {
		await status();

		return currentPrincipal ?? null;
	};

	const onPrincipalChange = (
		listener: (principal: MobileAuthPrincipal | null) => void
	) => {
		principalListeners.add(listener);
		if (currentPrincipal !== undefined) listener(currentPrincipal);

		return () => {
			principalListeners.delete(listener);
		};
	};

	const stop = async () => {
		await Promise.all([stopLinks?.(), stopResume?.()]);
		stopLinks = undefined;
		stopResume = undefined;
		startPromise = undefined;
	};

	return {
		fetch: authenticatedFetch,
		fetchOptional: optionalAuthenticatedFetch,
		handleCallback,
		onPrincipalChange,
		principal,
		refresh: refreshAccessToken,
		signIn,
		signOut,
		socketTicket,
		start,
		status,
		stop
	};
};

export type MobileAuthClient = ReturnType<typeof createMobileAuthClient>;

/** Adapts the native OAuth lifecycle behind the same createAuthClient API used
 * by web applications. Passwords stay out of the WebView request path; the
 * external authorization UI owns credential entry and MFA. */
export const createMobileAuthTransport = (
	client: MobileAuthClient,
	options: { baseUrl?: string } = {}
): import('./createAuthClient').AuthClientTransport => ({
	fetch: (input, init) => {
		const resolved =
			options.baseUrl &&
			(typeof input === 'string' || input instanceof URL)
				? new URL(String(input), options.baseUrl)
				: input;

		return client.fetchOptional(resolved, init);
	},
	signInEmail: async ({ email }) => {
		await client.signIn({
			authorizationParameters: { login_hint: email }
		});

		return { status: 'authenticated' };
	},
	signOut: async () => {
		await client.signOut();

		return null;
	},
	signUpEmail: async ({ email }) => {
		await client.signIn({
			authorizationParameters: {
				login_hint: email,
				screen_hint: 'signup'
			}
		});

		return { status: 'authenticated' };
	},
	status: async () => {
		const user = await client.status();

		return { user };
	}
});

export { installAuthClientRuntimeTransport } from './runtimeTransport';
