import { decodeJWT } from 'citra';
import { Cookie } from 'elysia';
import { MILLISECONDS_IN_A_DAY, MILLISECONDS_IN_AN_HOUR } from './constants';
import { isNonEmptyString, isStatusResponse } from './typeGuards';
import {
	AbsoluteAuthProps,
	GetStatusProps,
	InsantiateUserSessionProps,
	OAuth2ConfigurationOptions,
	UserSessionId
} from './types';

export const instantiateUserSession = async <UserType>({
	authProvider,
	session,
	userSessionIdCookie,
	unregisteredSession,
	tokenResponse,
	providerInstance,
	getUser,
	onNewUser
}: InsantiateUserSessionProps<UserType>) => {
	let userIdentity;
	let accessToken = tokenResponse.access_token;
	let refreshToken = tokenResponse.refresh_token;

	if (tokenResponse.id_token) {
		userIdentity = decodeJWT(tokenResponse.id_token);
	} else if (authProvider === 'withings') {
		// @ts-expect-error TODO: Withings is its own case edit the validate response to accept this case
		userIdentity = { userid: tokenResponse.body.userid };
		// @ts-expect-error TODO: Withings is its own case edit the validate response to accept this case
		accessToken = tokenResponse.body.access_token;
		// @ts-expect-error TODO: Withings is its own case edit the validate response to accept this case
		refreshToken = tokenResponse.body.refresh_token;
	} else {
		userIdentity = await providerInstance.fetchUserProfile(
			tokenResponse.access_token
		);
	}

	const userSession = validateSession({ session, userSessionIdCookie });
	const userSessionId = getUserSessionId(userSessionIdCookie);

	let user = userSession?.user ?? (await getUser(userIdentity));
	const response = user ?? (await onNewUser(userIdentity));

	if (response instanceof Response || isStatusResponse(response)) {
		unregisteredSession[userSessionId] = {
			expiresAt: Date.now() + MILLISECONDS_IN_AN_HOUR,
			userIdentity
		};

		return response;
	}

	user = response;

	session[userSessionId] = {
		accessToken,
		expiresAt: Date.now() + MILLISECONDS_IN_A_DAY,
		refreshToken,
		user
	};

	return void 0;
};

export const createAuthConfiguration = <UserType>(
	configuration: AbsoluteAuthProps<UserType>
) => configuration;

export const createProvidersConfiguration = (
	providersConfiguration: OAuth2ConfigurationOptions
) => providersConfiguration;

export const getStatus = async <UserType>({
	user_session_id,
	session,
	onStatus
}: GetStatusProps<UserType>) => {
	if (user_session_id === undefined) {
		return {
			error: {
				code: 'Bad Request',
				message: 'Cookies are missing'
			} as const,
			user: null
		};
	}

	const sessionId = user_session_id.value;
	const user =
		sessionId !== undefined && session[sessionId]
			? session[sessionId].user
			: null;

	try {
		await onStatus?.({ user });
	} catch (err) {
		return err instanceof Error
			? {
					error: {
						code: 'Internal Server Error',
						message: `Error: ${err.message} - ${err.stack ?? ''}`
					} as const,
					user: null
				}
			: {
					error: {
						code: 'Internal Server Error',
						message: `Unknown Error: ${String(err)}`
					} as const,
					user: null
				};
	}

	return {
		error: null,
		user
	};
};

type ValidateSessionProps<
	SessionType extends Record<string, unknown> & { expiresAt: number }
> = {
	userSessionIdCookie: Cookie<UserSessionId | undefined>;
	session: Record<UserSessionId, SessionType>;
};

export const validateSession = <
	SessionType extends Record<string, unknown> & { expiresAt: number }
>({
	userSessionIdCookie,
	session
}: ValidateSessionProps<SessionType>) => {
	const userSessionId = userSessionIdCookie.value;
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
		userSessionIdCookie.set({
			maxAge: 0,
			value: ''
		});

		return undefined;
	}

	return userSession;
};

export const getUserSessionId = (
	user_session_id: Cookie<
		`${string}-${string}-${string}-${string}-${string}` | undefined
	>
) => {
	const existingId = user_session_id?.value;
	const userSessionId = isNonEmptyString(existingId)
		? existingId
		: crypto.randomUUID();

	if (existingId === undefined) {
		user_session_id.set({
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			value: userSessionId
		});
	}

	return userSessionId;
};
