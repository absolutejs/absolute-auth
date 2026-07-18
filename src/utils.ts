import {
	decodeJWT,
	isValidProviderOption,
	normalizeProviderIdentity,
	OAuth2Client,
	OAuth2TokenResponse,
	ProviderConfig,
	ProviderOption,
	providers
} from 'citra';
import { Cookie } from 'elysia';
import { MILLISECONDS_IN_A_DAY, MILLISECONDS_IN_AN_HOUR } from './constants';
import { AuthHtmxConfig } from './htmx/types';
import { isNonEmptyString, isStatusResponse } from './typeGuards';
import {
	AuthConfig,
	AuthSettings,
	InsantiateUserSessionProps,
	OAuth2ConfigurationOptions,
	ResolvedOAuthAuthorization,
	SessionRecord,
	UnregisteredSessionRecord,
	UserSessionId
} from './types';

const MILLISECONDS_IN_A_SECOND = 1000;

const readOptionalString = (value: object, property: string) => {
	const candidate: unknown = Reflect.get(value, property);

	return typeof candidate === 'string' ? candidate : undefined;
};

export const defineAuthConfig = <UserType>(
	configuration: AuthConfig<UserType>
) => configuration;
export const defineAuthHtmxConfig = (htmxConfig: AuthHtmxConfig) => htmxConfig;
export const defineAuthSettings = (settings: AuthSettings) => settings;
export const defineProvidersConfiguration = (
	providersConfiguration: OAuth2ConfigurationOptions
) => providersConfiguration;
export const getStatus = async <UserType>(
	session: SessionRecord<UserType>,
	user_session_id: Cookie<UserSessionId | undefined>
) => {
	if (user_session_id === undefined) {
		return {
			error: {
				code: 'Bad Request',
				message: 'Cookies are missing'
			} as const,
			user: null
		};
	}

	const userSession = validateSession({ session, user_session_id });
	const user = userSession?.user ?? null;

	return {
		error: null,
		user
	};
};
export const instantiateUserSession = async <UserType>({
	authProvider,
	providerConfiguration,
	cookieSecure,
	session,
	user_session_id,
	unregisteredSession,
	tokenResponse,
	providerInstance,
	getUser,
	onNewUser,
	resolvedAuthorization,
	sessionDurationMs = MILLISECONDS_IN_A_DAY,
	unregisteredSessionDurationMs = MILLISECONDS_IN_AN_HOUR
}: InsantiateUserSessionProps<UserType>) => {
	const authorization =
		resolvedAuthorization ??
		(await resolveOAuthAuthorization({
			authProvider,
			providerConfiguration,
			providerInstance,
			tokenResponse
		}));
	const { accessToken, refreshToken, userIdentity } = authorization;

	const userSession = validateSession({ session, user_session_id });
	const userSessionId = getUserSessionId({
		cookieSecure,
		session,
		unregisteredSession,
		user_session_id
	});

	let user = userSession?.user ?? (await getUser(userIdentity));
	const response = user ?? (await onNewUser(userIdentity));

	const isRedirectOrStatus =
		response instanceof Response || isStatusResponse(response);

	if (!isRedirectOrStatus) {
		user = response;

		session[userSessionId] = {
			accessToken,
			authenticatedAt: Date.now(),
			expiresAt: Date.now() + sessionDurationMs,
			refreshToken,
			user
		};

		return void 0;
	}

	const existingUnregistered = unregisteredSession[userSessionId];

	if (existingUnregistered) {
		existingUnregistered.accessToken = accessToken;
		existingUnregistered.expiresAt =
			Date.now() + unregisteredSessionDurationMs;
		existingUnregistered.refreshToken = refreshToken;
		existingUnregistered.userIdentity = userIdentity;

		return response;
	}

	unregisteredSession[userSessionId] = {
		accessToken,
		expiresAt: Date.now() + unregisteredSessionDurationMs,
		refreshToken,
		userIdentity
	};

	return response;
};
// Cookie Secure flag resolution. Default convention: only set Secure=true in production
// (matches express-session, iron-session, lucia, better-auth). Hardcoding Secure=true broke
// non-browser HTTP clients (curl, SSR fetch, Playwright API contexts, test runners) on
// http://localhost in dev, because they don't honor the browser's "localhost is a secure
// context" exemption. An explicit `cookieSecure` on AuthConfig overrides; otherwise we
// look at NODE_ENV. Consumers running prod without NODE_ENV=production should set
// `cookieSecure: true` explicitly.
export const resolveCookieSecure = (override?: boolean) =>
	override ?? process.env.NODE_ENV === 'production';
export const resolveOAuthAuthorization = async ({
	authProvider,
	providerConfiguration,
	providerInstance,
	tokenResponse,
	now = Date.now()
}: {
	authProvider: string;
	providerConfiguration?: ProviderConfig;
	providerInstance: Pick<OAuth2Client<ProviderOption>, 'fetchUserProfile'>;
	tokenResponse: OAuth2TokenResponse;
	now?: number;
}): Promise<ResolvedOAuthAuthorization> => {
	// Custom providers aren't in the citra registry — their config must be
	// supplied by the caller (the callback context carries it).
	const meta =
		providerConfiguration ??
		(isValidProviderOption(authProvider)
			? providers[authProvider]
			: undefined);
	if (!meta) {
		throw new Error(
			`No provider configuration for "${authProvider}" — pass providerConfiguration (custom provider) or resolvedAuthorization`
		);
	}
	let userIdentity;
	let accessToken = tokenResponse.access_token;
	let refreshToken = tokenResponse.refresh_token;
	const withingsBody: unknown = Reflect.get(tokenResponse, 'body');
	const withingsAccessToken =
		authProvider === 'withings' &&
		withingsBody !== null &&
		typeof withingsBody === 'object'
			? readOptionalString(withingsBody, 'access_token')
			: undefined;
	if (!accessToken && withingsAccessToken !== undefined) {
		accessToken = withingsAccessToken;
	}
	if (typeof accessToken !== 'string' || accessToken.length === 0) {
		throw new Error(
			'OAuth authorization response contains no access_token'
		);
	}

	if (tokenResponse.id_token) {
		userIdentity = normalizeProviderIdentity({
			identity: decodeJWT(tokenResponse.id_token),
			providerConfiguration: meta,
			source: 'idToken'
		});
	} else if (meta.subjectBySource?.tokenResponse) {
		// Providers whose connected identity is returned as top-level fields in
		// the token-exchange response (e.g. GoHighLevel's locationId) rather than
		// via a profile endpoint. Read the subject straight from the token
		// response and skip the profile call.
		userIdentity = normalizeProviderIdentity({
			identity: tokenResponse,
			providerConfiguration: meta,
			source: 'tokenResponse'
		});
	} else if (authProvider === 'withings') {
		if (withingsBody === null || typeof withingsBody !== 'object') {
			throw new Error('Withings OAuth response contains no body');
		}
		userIdentity = { userid: Reflect.get(withingsBody, 'userid') };
		accessToken =
			readOptionalString(withingsBody, 'access_token') ?? accessToken;
		refreshToken =
			readOptionalString(withingsBody, 'refresh_token') ?? refreshToken;
	} else {
		userIdentity = normalizeProviderIdentity({
			identity: await providerInstance.fetchUserProfile(accessToken),
			providerConfiguration: meta,
			source: 'profile'
		});
	}

	const tokenType: unknown = Reflect.get(tokenResponse, 'token_type');

	return {
		accessToken,
		expiresAt: resolveOAuthTokenExpiresAt(tokenResponse, now),
		refreshToken,
		tokenType: typeof tokenType === 'string' ? tokenType : undefined,
		userIdentity
	};
};
const parseExpiresInSeconds = (expiresIn: unknown) => {
	if (typeof expiresIn === 'number') {
		return expiresIn;
	}

	if (typeof expiresIn === 'string' && expiresIn.trim().length > 0) {
		return Number(expiresIn);
	}

	return Number.NaN;
};

export const resolveOAuthTokenExpiresAt = (
	tokenResponse: OAuth2TokenResponse,
	now = Date.now()
) => {
	const expiresIn: unknown = Reflect.get(tokenResponse, 'expires_in');
	const expiresInSeconds = parseExpiresInSeconds(expiresIn);

	if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
		return undefined;
	}

	return now + expiresInSeconds * MILLISECONDS_IN_A_SECOND;
};

type ValidateSessionProps<
	SessionType extends Record<string, unknown> & { expiresAt: number }
> = {
	user_session_id: Cookie<UserSessionId | undefined>;
	session: Record<UserSessionId, SessionType>;
};

export const validateSession = <
	SessionType extends Record<string, unknown> & { expiresAt: number }
>({
	user_session_id,
	session
}: ValidateSessionProps<SessionType>) => {
	const userSessionId = user_session_id.value;
	if (!userSessionId) {
		return undefined;
	}

	const userSession = session[userSessionId];
	if (!userSession) {
		return undefined;
	}

	const isExpired = userSession.expiresAt < Date.now();
	if (isExpired) {
		delete session[userSessionId];
		user_session_id.remove();

		return undefined;
	}

	return userSession;
};

type GetUserSessionIdProps<UserType> = {
	cookieSecure?: boolean;
	user_session_id: Cookie<UserSessionId | undefined>;
	session?: SessionRecord<UserType>;
	unregisteredSession?: UnregisteredSessionRecord;
};

const clearExistingSession = <UserType>(
	existingId: UserSessionId,
	session?: SessionRecord<UserType>,
	unregisteredSession?: UnregisteredSessionRecord
) => {
	if (session) delete session[existingId];
	if (unregisteredSession) delete unregisteredSession[existingId];
};

export const getUserSessionId = <UserType>({
	cookieSecure,
	user_session_id,
	session,
	unregisteredSession
}: GetUserSessionIdProps<UserType>) => {
	const existingId = user_session_id?.value;

	if (isNonEmptyString(existingId)) {
		clearExistingSession(existingId, session, unregisteredSession);
	}

	const userSessionId = crypto.randomUUID();

	user_session_id.set({
		httpOnly: true,
		sameSite: 'lax',
		secure: resolveCookieSecure(cookieSecure),
		value: userSessionId
	});

	return userSessionId;
};
