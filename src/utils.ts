import { Cookie } from 'elysia';
import { MILLISECONDS_IN_A_DAY } from './constants';
import { AbsoluteAuthProps, SessionRecord } from './types';
import { isValidUser } from './typeGuards';

type InsantiateUserSessionProps<UserType> = {
	authProvider: string;
	decodedIdToken: {
		[key: string]: string | undefined;
	};
	session: SessionRecord<UserType>;
	user_session_id: Cookie<string | undefined>;
	createUser: () => UserType | Promise<UserType>;
	getUser: () => UserType | Promise<UserType | null>;
};

export const instantiateUserSession = async <UserType>({
	user_session_id,
	session,
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
		expiresAt: Date.now() + MILLISECONDS_IN_A_DAY,
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
