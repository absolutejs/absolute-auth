import { decodeJWT } from 'citra';
import { MILLISECONDS_IN_A_DAY } from './constants';
import { isValidUser } from './typeGuards';
import {
	AbsoluteAuthProps,
	InsantiateUserSessionProps,
	OAuth2ConfigurationOptions
} from './types';

export const instantiateUserSession = async <UserType>({
	user_session_id,
	authProvider,
	session,
	tokenResponse,
	providerInstance,
	getUser,
	createUser
}: InsantiateUserSessionProps<UserType>) => {
	let userProfile;

	if (tokenResponse.id_token) {
		userProfile = decodeJWT(tokenResponse.id_token);
	} else if (authProvider === 'withings') {
		// @ts-expect-error TODO: Withings is its own case edit the validate response to accept this case
		userProfile = tokenResponse.body;
	} else {
		userProfile = await providerInstance.fetchUserProfile(
			tokenResponse.access_token
		);
	}

	let user = await getUser(userProfile);
	user = user ?? (await createUser(userProfile));

	// TODO : See if theres a better way to check valid user and not throw an error
	if (!isValidUser<UserType>(user))
		throw new Error('Internal Server Error - Invalid user schema');

	const sessionKey = crypto.randomUUID();

	session[sessionKey] = {
		accessToken: tokenResponse.access_token,
		expiresAt: Date.now() + MILLISECONDS_IN_A_DAY,
		refreshToken: tokenResponse.refresh_token,
		user
	};

	user_session_id.set({
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		value: sessionKey
	});
};

export const createAuthConfiguration = <UserType>(
	configuration: AbsoluteAuthProps<UserType>
) => configuration;

export const createProvidersConfiguration = (
	providersConfiguration: OAuth2ConfigurationOptions
) => providersConfiguration;
