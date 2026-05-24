import {
	decodeJWT,
	normalizeProviderIdentity,
	OAuth2Client,
	OAuth2TokenResponse,
	ProviderOption,
	providers
} from 'citra';
import { Cookie } from 'elysia';
import { MILLISECONDS_IN_A_DAY, MILLISECONDS_IN_AN_HOUR } from './constants';
import { isNonEmptyString, isStatusResponse } from './typeGuards';
import {
	AuthConfig,
	InsantiateUserSessionProps,
	OAuth2ConfigurationOptions,
	ResolvedOAuthAuthorization,
	SessionRecord,
	UnregisteredSessionRecord,
	UserSessionId
} from './types';

export const resolveOAuthTokenExpiresAt = (
	tokenResponse: OAuth2TokenResponse,
	now = Date.now()
) => {
	const expiresIn = Reflect.get(tokenResponse as object, 'expires_in');
	const expiresInSeconds =
		typeof expiresIn === 'number'
			? expiresIn
			: typeof expiresIn === 'string' && expiresIn.trim().length > 0
				? Number(expiresIn)
				: Number.NaN;

	if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
		return undefined;
	}

	return now + expiresInSeconds * 1000;
};

export const resolveOAuthAuthorization = async ({
	authProvider,
	providerInstance,
	tokenResponse,
	now = Date.now()
}: {
	authProvider: ProviderOption;
	providerInstance: OAuth2Client<ProviderOption>;
	tokenResponse: OAuth2TokenResponse;
	now?: number;
}): Promise<ResolvedOAuthAuthorization> => {
	let userIdentity;
	let accessToken = tokenResponse.access_token;
	let refreshToken = tokenResponse.refresh_token;

	if (tokenResponse.id_token) {
		userIdentity = normalizeProviderIdentity({
			identity: decodeJWT(tokenResponse.id_token),
			providerConfiguration: providers[authProvider],
			source: 'idToken'
		});
	} else if (authProvider === 'withings') {
		// @ts-expect-error TODO: Withings is its own case edit the validate response to accept this case
		userIdentity = { userid: tokenResponse.body.userid };
		// @ts-expect-error TODO: Withings is its own case edit the validate response to accept this case
		accessToken = tokenResponse.body.access_token;
		// @ts-expect-error TODO: Withings is its own case edit the validate response to accept this case
		refreshToken = tokenResponse.body.refresh_token;
	} else {
		userIdentity = normalizeProviderIdentity({
			identity: await providerInstance.fetchUserProfile(
				tokenResponse.access_token
			),
			providerConfiguration: providers[authProvider],
			source: 'profile'
		});
	}

	const tokenType = Reflect.get(tokenResponse as object, 'token_type');

	return {
		accessToken,
		expiresAt: resolveOAuthTokenExpiresAt(tokenResponse, now),
		refreshToken,
		tokenType: typeof tokenType === 'string' ? tokenType : undefined,
		userIdentity
	};
};

export const instantiateUserSession = async <UserType>({
	authProvider,
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
			providerInstance,
			tokenResponse
		}));
	const { accessToken, refreshToken, userIdentity } = authorization;

	const userSession = validateSession({ session, user_session_id });
	const userSessionId = getUserSessionId({
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

export const defineAuthConfig = <UserType>(
	configuration: AuthConfig<UserType>
) => configuration;

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
		secure: true,
		value: userSessionId
	});

	return userSessionId;
};
