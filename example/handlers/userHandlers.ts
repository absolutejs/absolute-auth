import {
	extractPropFromIdentity,
	isValidProviderOption,
	providers
} from 'citra';
import { eq } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { NewUser, schema, SchemaType } from '../db/schema';
import { UserFunctionProps } from '../utils/types';

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
	userIdentity,
	authProvider,
	db
}: UserFunctionProps<SchemaType>) => {
	if (!isValidProviderOption(authProvider)) {
		throw new Error(`Invalid auth provider: ${authProvider}`);
	}

	const provider = authProvider.toUpperCase();
	const providerConfiguration = providers[authProvider];

	const subject = extractPropFromIdentity(
		userIdentity,
		providerConfiguration.subject,
		providerConfiguration.subjectType
	);
	const authSub = `${provider}|${subject}`;

	return createDBUser({
		auth_sub: authSub,
		db,
		metadata: userIdentity
	});
};

export const getUser = ({
	userIdentity,
	authProvider,
	db
}: UserFunctionProps<SchemaType>) => {
	if (!isValidProviderOption(authProvider)) {
		throw new Error(`Invalid auth provider: ${authProvider}`);
	}

	const provider = authProvider.toUpperCase();
	const providerConfiguration = providers[authProvider];

	const subject = extractPropFromIdentity(
		userIdentity,
		providerConfiguration.subject,
		providerConfiguration.subjectType
	);
	const authSub = `${provider}|${subject}`;

	return getDBUser({ authSub, db });
};
