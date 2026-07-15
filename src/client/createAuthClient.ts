// Framework-agnostic client SDK over the auth endpoints. Thin fetch wrappers with
// configurable routes, a uniform `{ data, error }` return, and same-origin cookies on by
// default — the primitive the React hooks (`./react`) and future Vue/Solid composables wrap.
// HTMX is the special case (declarative server fragments via `./htmx`); for every other UI
// framework the natural primitive is this client + your framework's reactivity.

export type AuthClientError = {
	body: unknown;
	message: string;
	status: number;
};

export type AuthClientResult<T> =
	| { data: null; error: AuthClientError }
	| { data: T; error: null };

// Each entry is the URL the consumer's auth() mounted that flow at. Defaults match the
// package defaults; override to match your own custom routes.
export type AuthClientRoutes = {
	emailVerify?: string;
	emailVerifyRequest?: string;
	login?: string;
	magicLinkRequest?: string;
	magicLinkVerify?: string;
	mfaChallenge?: string;
	mfaManagement?: string;
	mfaSetup?: string;
	mfaVerifySetup?: string;
	passkeyAuthenticateOptions?: string;
	passkeyAuthenticateVerify?: string;
	passkeyList?: string;
	passkeyRegisterOptions?: string;
	passkeyRegisterVerify?: string;
	passkeyRemove?: string;
	passwordReset?: string;
	passwordResetRequest?: string;
	register?: string;
	sessions?: string;
	signout?: string;
	status?: string;
};

const DEFAULT_ROUTES: Required<AuthClientRoutes> = {
	emailVerify: '/auth/verify-email',
	emailVerifyRequest: '/auth/verify-email/request',
	login: '/auth/login',
	magicLinkRequest: '/auth/passwordless/magic-link',
	magicLinkVerify: '/auth/passwordless/magic-link/verify',
	mfaChallenge: '/auth/mfa/totp/challenge',
	mfaManagement: '/auth/mfa',
	mfaSetup: '/auth/mfa/totp/setup',
	mfaVerifySetup: '/auth/mfa/totp/verify',
	passkeyAuthenticateOptions: '/auth/webauthn/authenticate/options',
	passkeyAuthenticateVerify: '/auth/webauthn/authenticate/verify',
	passkeyList: '/auth/webauthn/credentials',
	passkeyRegisterOptions: '/auth/webauthn/register/options',
	passkeyRegisterVerify: '/auth/webauthn/register/verify',
	passkeyRemove: '/auth/webauthn/credentials',
	passwordReset: '/auth/reset-password',
	passwordResetRequest: '/auth/reset-password/request',
	register: '/auth/register',
	sessions: '/auth/sessions',
	signout: '/oauth2/signout',
	status: '/oauth2/status'
};

export type AuthClientConfig = {
	baseUrl?: string;
	credentials?: RequestCredentials;
	fetch?: typeof fetch;
	routes?: AuthClientRoutes;
};

const succeed = <T>(data: T): AuthClientResult<T> => ({
	data,
	error: null
});

const fail = (error: AuthClientError): AuthClientResult<never> => ({
	data: null,
	error
});

const errorFor = (response: Response, body: unknown): AuthClientError => ({
	body,
	message:
		typeof body === 'string'
			? body
			: (readMessage(body) ?? response.statusText),
	status: response.status
});

export const createAuthClient = ({
	baseUrl = '',
	credentials = 'same-origin',
	fetch: fetchImpl = fetch,
	routes
}: AuthClientConfig = {}) => {
	const resolvedRoutes: Required<AuthClientRoutes> = {
		...DEFAULT_ROUTES,
		...routes
	};

	const request = async <T>(path: string, init: RequestInit) => {
		try {
			const response = await fetchImpl(`${baseUrl}${path}`, {
				credentials,
				...init
			});
			const text = await response.text();
			const body: unknown = text === '' ? null : safeJson(text);
			if (!response.ok) return fail(errorFor(response, body));

			// Trust the caller's expectation at the deserialization boundary.
			// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- HTTP response is unknown until parsed; the call site declares the expected T
			return succeed(body as T);
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : 'network';

			return fail({ body: null, message, status: 0 });
		}
	};

	const post = <T>(path: string, body?: unknown, method = 'POST') =>
		request<T>(path, {
			body: body === undefined ? undefined : JSON.stringify(body),
			headers:
				body === undefined
					? undefined
					: { 'content-type': 'application/json' },
			method
		});

	const get = <T>(path: string) => request<T>(path, { method: 'GET' });

	const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

	return {
		emailVerification: {
			request: (body: { email: string }) =>
				post<{ ok: true }>(resolvedRoutes.emailVerifyRequest, body),
			verify: (body: { token: string }) =>
				post<{ ok: true }>(resolvedRoutes.emailVerify, body)
		},
		mfa: {
			challenge: (body: { code: string }) =>
				post<{ status: 'authenticated' }>(
					resolvedRoutes.mfaChallenge,
					body
				),
			disable: () =>
				del<{ status: 'disabled' }>(resolvedRoutes.mfaManagement),
			setup: () =>
				post<{ secret: string; uri: string }>(resolvedRoutes.mfaSetup),
			status: () =>
				get<import('../mfa/management').MfaStatus>(
					resolvedRoutes.mfaManagement
				),
			verifySetup: (body: { code: string }) =>
				post<{ backupCodes: string[] }>(
					resolvedRoutes.mfaVerifySetup,
					body
				)
		},
		passkeys: {
			authenticateOptions: () =>
				post<unknown>(resolvedRoutes.passkeyAuthenticateOptions),
			authenticateVerify: (response: unknown) =>
				post<{ status: 'authenticated' }>(
					resolvedRoutes.passkeyAuthenticateVerify,
					response
				),
			list: () => get<unknown[]>(resolvedRoutes.passkeyList),
			registerOptions: () =>
				post<unknown>(resolvedRoutes.passkeyRegisterOptions),
			registerVerify: (response: unknown) =>
				post<{ ok: true }>(
					resolvedRoutes.passkeyRegisterVerify,
					response
				),
			remove: (credentialId: string) =>
				del<{ ok: true }>(
					`${resolvedRoutes.passkeyRemove}/${encodeURIComponent(credentialId)}`
				)
		},
		passwordless: {
			requestMagicLink: (body: { email: string }) =>
				post<{ ok: true }>(resolvedRoutes.magicLinkRequest, body),
			verifyMagicLink: (body: { token: string }) =>
				post<{ status: 'authenticated' }>(
					resolvedRoutes.magicLinkVerify,
					body
				)
		},
		passwordReset: {
			confirm: (body: { password: string; token: string }) =>
				post<{ ok: true }>(resolvedRoutes.passwordReset, body),
			request: (body: { email: string }) =>
				post<{ ok: true }>(resolvedRoutes.passwordResetRequest, body)
		},
		sessions: {
			list: () => get<unknown[]>(resolvedRoutes.sessions),
			revoke: (sessionId: string) =>
				del<{ ok: true }>(
					`${resolvedRoutes.sessions}/${encodeURIComponent(sessionId)}`
				)
		},
		signIn: {
			email: (body: { email: string; password: string }) =>
				post<{
					passwordCompromised?: boolean;
					status: 'authenticated' | 'mfa_required';
				}>(resolvedRoutes.login, body)
		},
		signUp: {
			email: (body: {
				email: string;
				password: string;
				[extra: string]: unknown;
			}) =>
				post<
					| { status: 'authenticated' }
					| { status: 'verification_required' }
				>(resolvedRoutes.register, body)
		},
		signOut: () => del<null>(resolvedRoutes.signout),
		status: () =>
			get<{ impersonator?: unknown; user: unknown | null }>(
				resolvedRoutes.status
			)
	};
};

const safeJson = (text: string) => {
	try {
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- deserialization boundary
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
};

const readMessage = (body: unknown) => {
	if (typeof body !== 'object' || body === null) return undefined;
	const message: unknown = Reflect.get(body, 'message');

	return typeof message === 'string' ? message : undefined;
};

export type AuthClient = ReturnType<typeof createAuthClient>;
