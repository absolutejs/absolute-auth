import { eq } from 'drizzle-orm';
import type { DatabaseFunctionProps, NewUser } from '../db/schema';
import { UserFunctionProps } from '../../src/types';

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
				given_name: given_name,
				family_name: family_name,
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

export const createUser = async ({
	decodedIdToken,
	authProvider,
	db,
	schema
}: UserFunctionProps & DatabaseFunctionProps) => {
	const provider = authProvider.toUpperCase();
	const sub = decodedIdToken.sub;

	if (!sub) {
		throw new Error('Sub claim is missing from ID token');
	}

	const authSub = `${provider}|${sub}`;
	return await createDBUser({
		auth_sub: authSub,
		given_name: decodedIdToken.given_name ?? '',
		family_name: decodedIdToken.family_name ?? '',
		email: decodedIdToken.email ?? '',
		picture: decodedIdToken.picture ?? '',
		db,
		schema
	});
};

export const getUser = async ({
	decodedIdToken,
	authProvider,
	db,
	schema
}: UserFunctionProps & DatabaseFunctionProps) => {
	const provider = authProvider.toUpperCase();
	const sub = decodedIdToken.sub;

	if (!sub) {
		throw new Error('Sub claim is missing from ID token');
	}

	const authSub = `${provider}|${sub}`;
	return await getDBUser({ authSub, db, schema });
};
