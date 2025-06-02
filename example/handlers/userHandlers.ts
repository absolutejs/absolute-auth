import { eq } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { NewUser, schema, SchemaType } from '../db/schema';
import { UserFunctionProps } from '../../src';

export const getDBUser = async ({
	authSub,
	db
}: {
	authSub: string;
	db: NeonHttpDatabase<SchemaType>;
}) => {
	const [user] = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.auth_sub, authSub))
		.execute();

	return user;
};

export const createDBUser = async ({
	auth_sub,
	db,
	metadata
}: NewUser & { db: NeonHttpDatabase<SchemaType> }) => {
	const [newUser] = await db
		.insert(schema.users)
		.values({
			auth_sub,
			metadata
		})
		.returning();

	return newUser;
};

export const createUser = ({
	userProfile,
	authProvider,
	db
}: UserFunctionProps & {
	db: NeonHttpDatabase<SchemaType>;
}) => {
	const provider = authProvider.toUpperCase();
	const { sub, id, userid } = userProfile;

	if (!sub && !id && !userid) {
		throw new Error('No sub or ID claim found in ID token');
	}
	const authSub = `${provider}|${sub ?? id ?? userid}`;

	return createDBUser({
		auth_sub: authSub,
		db,
		metadata: userProfile
	});
};

export const getUser = ({
	userProfile,
	authProvider,
	db
}: UserFunctionProps & {
	db: NeonHttpDatabase<SchemaType>;
}) => {
	const provider = authProvider.toUpperCase();
	const { sub, id, userid } = userProfile;

	if (!sub && !id && !userid) {
		throw new Error('No sub or ID claim found in ID token');
	}

	const authSub = `${provider}|${sub ?? id ?? userid}`;

	return getDBUser({ authSub, db });
};
