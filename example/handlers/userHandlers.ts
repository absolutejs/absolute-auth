import { eq } from 'drizzle-orm';
import { UserFunctionProps } from '../../src/types';
import type { DatabaseFunctionProps, NewUser } from '../db/schema';

export const getDBUser = async ({
	authSub,
	db,
	schema
}: DatabaseFunctionProps & { authSub: string }) => {
	try {
		const user = await db
			.select()
			.from(schema.users)
			.where(eq(schema.users.auth_sub, authSub))
			.execute();

		if (user.length === 0) {
			return null;
		}

		return user[0];
	} catch (error) {
		console.error('Error fetching user:', error);

		if (error instanceof Error) {
			throw new Error(`Database query failed: ${error.message}`);
		} else {
			throw new Error(
				'An unknown error occurred while fetching the user'
			);
		}
	}
};

export const createDBUser = async ({
	auth_sub,
	given_name,
	family_name,
	email,
	picture,
	db,
	schema
}: DatabaseFunctionProps & NewUser) => {
	try {
		const newUser = await db
			.insert(schema.users)
			.values({
				auth_sub: auth_sub,
				email,
				family_name: family_name,
				given_name: given_name,
				picture
			})
			.returning();

		return newUser[0];
	} catch (error) {
		console.error('Error creating user:', error);

		if (error instanceof Error) {
			throw new Error(`Failed to create user: ${error.message}`);
		} else {
			throw new Error(
				'An unknown error occurred while creating the user'
			);
		}
	}
};

export const createUser = ({
	userProfile,
	authProvider,
	db,
	schema
}: UserFunctionProps & DatabaseFunctionProps) => {
	const provider = authProvider.toUpperCase();
	const { sub, id, email, family_name, given_name, picture, avatar_url } =
		userProfile;

	if (!sub && !id) {
		throw new Error('No sub or ID claim found in ID token');
	}
	const authSub = `${provider}|${sub || id}`;

	let pictureUrl = '';
	if (typeof picture === 'string') {
		pictureUrl = picture;
	} else if (typeof avatar_url === 'string') {
		pictureUrl = avatar_url;
	}

	return createDBUser({
		auth_sub: authSub,
		db,
		email: typeof email === 'string' ? email : '',
		family_name: typeof family_name === 'string' ? family_name : '',
		given_name: typeof given_name === 'string' ? given_name : '',
		picture: pictureUrl,
		schema
	});
};

export const getUser = ({
	userProfile,
	authProvider,
	db,
	schema
}: UserFunctionProps & DatabaseFunctionProps) => {
	const provider = authProvider.toUpperCase();
	const { sub, id } = userProfile;

	if (!sub && !id) {
		throw new Error('No sub or ID claim found in ID token');
	}

	const authSub = `${provider}|${sub ?? id}`;

	console.log(authSub);

	return getDBUser({ authSub, db, schema });
};
