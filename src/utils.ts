import { decodeJWT } from 'citra';
import { Cookie } from 'elysia';
import { MILLISECONDS_IN_A_DAY, MILLISECONDS_IN_AN_HOUR } from './constants';
import { isNonEmptyString, isStatusResponse } from './typeGuards';
import {
	AbsoluteAuthProps,
	InsantiateUserSessionProps,
	OAuth2ConfigurationOptions,
	SessionRecord,
	UserSessionId
} from './types';

export const instantiateUserSession = async <UserType>({
	authProvider,
	session,
	user_session_id,
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

	const userSession = validateSession({ session, user_session_id });
	const userSessionId = getUserSessionId(user_session_id);

	let user = userSession?.user ?? (await getUser(userIdentity));
	const response = user ?? (await onNewUser(userIdentity));

	if (response instanceof Response || isStatusResponse(response)) {
		unregisteredSession[userSessionId] = {
			accessToken,
			expiresAt: Date.now() + MILLISECONDS_IN_AN_HOUR,
			refreshToken,
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
