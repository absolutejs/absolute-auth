import { decodeJWT } from 'citra';
import { MILLISECONDS_IN_A_DAY } from './constants';
import { isValidUser } from './typeGuards';
import {
	AbsoluteAuthProps,
	GetStatusProps,
	InsantiateUserSessionProps,
	OAuth2ConfigurationOptions
} from './types';

export const instantiateUserSession = async <UserType>({
	userSessionId,
	authProvider,
	session,
	tokenResponse,
	providerInstance,
	getUser,
	createUser
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

	let user = await getUser(userIdentity);
	user = user ?? (await createUser(userIdentity));

	// TODO : See if theres a better way to check valid user and not throw an status
	if (!isValidUser<UserType>(user))
		throw new Error('Internal Server Error - Invalid user schema');

	session[userSessionId] = {
		accessToken,
		expiresAt: Date.now() + MILLISECONDS_IN_A_DAY,
		refreshToken,
		user
	};
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
				code: 'Bad Request' as const,
				message: 'Cookies are missing'
			},
			type: 'error' as const
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
		if (err instanceof Error) {
			return {
				error: {
					code: 'Internal Server Error' as const,
					message: `Error: ${err.message} - ${err.stack ?? ''}`
				},
				type: 'error' as const
			};
		}

		return {
			error: {
				code: 'Internal Server Error' as const,
				message: `Unknown Error: ${String(err)}`
			},
			type: 'error' as const
		};
	}

	return { isLoggedIn: user !== null, type: 'success' as const, user };
};
