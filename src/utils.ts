import { MILLISECONDS_IN_A_DAY } from './constants';
import { isValidUser } from './typeGuards';
import { AbsoluteAuthProps, InsantiateUserSessionProps } from './types';

export const instantiateUserSession = async <UserType>({
	user_session_id,
	session,
	tokens,
	getUser,
	createUser
}: InsantiateUserSessionProps<UserType>) => {
	let user = await getUser();
	user = user ?? (await createUser());

	// TODO : See if theres a better way to check valid user and not throw an error
	if (!isValidUser<UserType>(user))
		throw new Error('Internal Server Error - Invalid user schema');

	const sessionKey = crypto.randomUUID();

	session[sessionKey] = {
		accessToken: tokens.access_token,
		expiresAt: Date.now() + MILLISECONDS_IN_A_DAY,
		refreshToken: tokens.refresh_token,
		user
	};

	user_session_id.set({
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		value: sessionKey
	});
};

export const createAuthConfig = <UserType>(
	props: AbsoluteAuthProps<UserType>
) => props;
