import {
	extractPropFromIdentity,
	isValidProviderOption,
	providers
} from 'citra';
import { and, eq, inArray } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { AbsoluteAuthIdentityConflictError } from '../../src';
import {
	AuthIdentity,
	NewAuthIdentity,
	NewAuthIdentityMergeRequest,
	NewUser,
	schema,
	SchemaType
} from '../db/schema';
import { LinkUserIdentityProps, UserFunctionProps } from '../utils/types';

type GetDBUserProps = {
	userSub: string;
	db: NeonHttpDatabase<SchemaType>;
};

type CanonicalUserFields = Pick<NewUser, 'email' | 'first_name' | 'last_name'>;

const normalizeOptionalString = (value: unknown) => {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
};

const extractOptionalProviderString = ({
	userIdentity,
	keys
}: {
	userIdentity: Record<string, unknown>;
	keys?: string[];
}) => {
	if (!keys || keys.length === 0) {
		return undefined;
	}

	try {
		return normalizeOptionalString(
			extractPropFromIdentity(userIdentity, keys, 'string')
		);
	} catch {
		return undefined;
	}
};

export const buildCanonicalUserFieldsFromIdentity = ({
	authProvider,
	userIdentity
}: {
	authProvider: string;
	userIdentity: Record<string, unknown>;
}): CanonicalUserFields => {
	if (!isValidProviderOption(authProvider)) {
		throw new Error(`Invalid auth provider: ${authProvider}`);
	}

	const providerConfiguration = providers[authProvider];
	const fullName = extractOptionalProviderString({
		userIdentity,
		keys: providerConfiguration.fullName
	});
	const fullNameParts = fullName?.split(/\s+/).filter(Boolean) ?? [];
	const fallbackFirstName = fullNameParts[0];
	const fallbackLastName =
		fullNameParts.length > 1 ? fullNameParts.slice(1).join(' ') : undefined;

	return {
		email:
			extractOptionalProviderString({
				userIdentity,
				keys: providerConfiguration.email
			})?.toLowerCase() ?? null,
		first_name:
			extractOptionalProviderString({
				userIdentity,
				keys: providerConfiguration.givenName
			}) ??
			fallbackFirstName ??
			null,
		last_name:
			extractOptionalProviderString({
				userIdentity,
				keys: providerConfiguration.familyName
			}) ??
			fallbackLastName ??
			null
	};
};

export const getDBUser = async ({ userSub, db }: GetDBUserProps) => {
	const [user] = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.sub, userSub))
		.execute();

	return user;
};

export const createDBUser = async ({
	sub,
	db,
	email,
	first_name,
	last_name,
	primary_auth_identity_id
}: NewUser & { db: NeonHttpDatabase<SchemaType> }) => {
	const [newUser] = await db
		.insert(schema.users)
		.values({
			sub,
			email,
			first_name,
			last_name,
			primary_auth_identity_id
		})
		.returning();

	return newUser;
};

export const updateDBUser = async ({
	userSub,
	db,
	fields
}: {
	userSub: string;
	db: NeonHttpDatabase<SchemaType>;
	fields: Partial<NewUser>;
}) => {
	const [user] = await db
		.update(schema.users)
		.set(fields)
		.where(eq(schema.users.sub, userSub))
		.returning();

	return user;
};

export const updateDBUserPrimaryAuthIdentity = async ({
	userSub,
	db,
	primaryAuthIdentityId
}: {
	userSub: string;
	db: NeonHttpDatabase<SchemaType>;
	primaryAuthIdentityId: string;
}) =>
	updateDBUser({
		userSub,
		db,
		fields: { primary_auth_identity_id: primaryAuthIdentityId }
	});

const createIdentityId = ({
	authProvider,
	providerSubject
}: {
	authProvider: string;
	providerSubject: string;
}) => `${authProvider}:${providerSubject}`;

const createAccountId = () => crypto.randomUUID();

const createMergeRequestId = ({
	sourceUserSub,
	targetUserSub,
	authProvider,
	providerSubject
}: {
	sourceUserSub: string;
	targetUserSub: string;
	authProvider: string;
	providerSubject: string;
}) =>
	`merge:${targetUserSub}:${sourceUserSub}:${authProvider}:${providerSubject}`;

const buildProviderSubjectFromIdentity = ({
	authProvider,
	userIdentity
}: {
	authProvider: string;
	userIdentity: Record<string, unknown>;
}) => {
	if (!isValidProviderOption(authProvider)) {
		throw new Error(`Invalid auth provider: ${authProvider}`);
	}

	const providerConfiguration = providers[authProvider];

	return String(
		extractPropFromIdentity(
			userIdentity,
			providerConfiguration.subject,
			providerConfiguration.subjectType
		)
	);
};

export const createDBAuthIdentity = async ({
	auth_provider,
	db,
	id,
	metadata,
	provider_subject,
	user_sub
}: NewAuthIdentity & { db: NeonHttpDatabase<SchemaType> }) => {
	const [identity] = await db
		.insert(schema.authIdentities)
		.values({
			auth_provider,
			id,
			metadata,
			provider_subject,
			user_sub
		})
		.returning();

	return identity;
};

export const getDBAuthIdentity = async ({
	authProvider,
	db,
	providerSubject
}: {
	authProvider: string;
	db: NeonHttpDatabase<SchemaType>;
	providerSubject: string;
}) => {
	const [identity] = await db
		.select()
		.from(schema.authIdentities)
		.where(
			and(
				eq(schema.authIdentities.auth_provider, authProvider),
				eq(schema.authIdentities.provider_subject, providerSubject)
			)
		)
		.execute();

	return identity;
};

export const getDBAuthIdentityById = async ({
	db,
	id
}: {
	db: NeonHttpDatabase<SchemaType>;
	id: string;
}) => {
	const [identity] = await db
		.select()
		.from(schema.authIdentities)
		.where(eq(schema.authIdentities.id, id))
		.execute();

	return identity;
};

export const listDBAuthIdentitiesByUser = async ({
	db,
	userSub
}: {
	db: NeonHttpDatabase<SchemaType>;
	userSub: string;
}) =>
	await db
		.select()
		.from(schema.authIdentities)
		.where(eq(schema.authIdentities.user_sub, userSub))
		.execute();

export const removeDBAuthIdentity = async ({
	db,
	id
}: {
	db: NeonHttpDatabase<SchemaType>;
	id: string;
}) => {
	await db
		.delete(schema.authIdentities)
		.where(eq(schema.authIdentities.id, id));
};

export const createDBAuthIdentityMergeRequest = async ({
	db,
	...values
}: NewAuthIdentityMergeRequest & { db: NeonHttpDatabase<SchemaType> }) => {
	const [request] = await db
		.insert(schema.authIdentityMergeRequests)
		.values(values)
		.returning();

	return request;
};

export const getDBAuthIdentityMergeRequest = async ({
	db,
	id
}: {
	db: NeonHttpDatabase<SchemaType>;
	id: string;
}) => {
	const [request] = await db
		.select()
		.from(schema.authIdentityMergeRequests)
		.where(eq(schema.authIdentityMergeRequests.id, id))
		.execute();

	return request;
};

export const listDBAuthIdentityMergeRequestsByTarget = async ({
	db,
	targetUserSub
}: {
	db: NeonHttpDatabase<SchemaType>;
	targetUserSub: string;
}) =>
	await db
		.select()
		.from(schema.authIdentityMergeRequests)
		.where(
			eq(schema.authIdentityMergeRequests.target_user_sub, targetUserSub)
		)
		.execute();

export const upsertDBAuthIdentityMergeRequest = async ({
	authProvider,
	db,
	metadata,
	providerSubject,
	sourceUserSub,
	targetUserSub
}: {
	authProvider: string;
	db: NeonHttpDatabase<SchemaType>;
	metadata?: Record<string, unknown>;
	providerSubject: string;
	sourceUserSub: string;
	targetUserSub: string;
}) => {
	const id = createMergeRequestId({
		authProvider,
		providerSubject,
		sourceUserSub,
		targetUserSub
	});
	const existing = await getDBAuthIdentityMergeRequest({ db, id });
	if (existing !== undefined) {
		const [updated] = await db
			.update(schema.authIdentityMergeRequests)
			.set({
				metadata: metadata ?? existing.metadata,
				status: 'pending',
				updated_at: new Date()
			})
			.where(eq(schema.authIdentityMergeRequests.id, id))
			.returning();

		return updated;
	}

	return createDBAuthIdentityMergeRequest({
		conflicting_auth_provider: authProvider,
		conflicting_provider_subject: providerSubject,
		db,
		id,
		metadata,
		source_user_sub: sourceUserSub,
		status: 'pending',
		target_user_sub: targetUserSub
	});
};

export const updateDBAuthIdentityMergeRequestStatus = async ({
	db,
	id,
	status,
	metadata
}: {
	db: NeonHttpDatabase<SchemaType>;
	id: string;
	status: string;
	metadata?: Record<string, unknown>;
}) => {
	const [request] = await db
		.update(schema.authIdentityMergeRequests)
		.set({
			metadata,
			status,
			updated_at: new Date()
		})
		.where(eq(schema.authIdentityMergeRequests.id, id))
		.returning();

	return request;
};

export const deleteDBAuthIdentityMergeRequest = async ({
	db,
	id
}: {
	db: NeonHttpDatabase<SchemaType>;
	id: string;
}) => {
	await db
		.delete(schema.authIdentityMergeRequests)
		.where(eq(schema.authIdentityMergeRequests.id, id));
};

export const linkUserIdentity = async ({
	authProvider,
	db,
	userSub,
	userIdentity
}: LinkUserIdentityProps<SchemaType>): Promise<{
	identity: AuthIdentity;
	status: 'already_linked' | 'created';
}> => {
	const providerSubject = buildProviderSubjectFromIdentity({
		authProvider,
		userIdentity
	});
	const existingIdentity = await getDBAuthIdentity({
		authProvider,
		db,
		providerSubject
	});

	if (
		existingIdentity !== undefined &&
		existingIdentity.user_sub !== userSub
	) {
		throw new AbsoluteAuthIdentityConflictError({
			authProvider,
			currentUserAuthSub: userSub,
			existingUserAuthSub: existingIdentity.user_sub,
			providerSubject
		});
	}

	if (existingIdentity !== undefined) {
		return {
			identity: existingIdentity,
			status: 'already_linked' as const
		};
	}

	const identity = await createDBAuthIdentity({
		auth_provider: authProvider,
		db,
		id: createIdentityId({ authProvider, providerSubject }),
		metadata: userIdentity,
		provider_subject: providerSubject,
		user_sub: userSub
	});

	if (identity === undefined) {
		throw new Error('Failed to create auth identity');
	}

	return {
		identity,
		status: 'created' as const
	};
};

export const syncDBUserFromAuthIdentity = async ({
	db,
	identity,
	userSub
}: {
	db: NeonHttpDatabase<SchemaType>;
	identity: AuthIdentity;
	userSub: string;
}) => {
	const fields = buildCanonicalUserFieldsFromIdentity({
		authProvider: identity.auth_provider,
		userIdentity: identity.metadata ?? {}
	});

	return updateDBUser({
		userSub,
		db,
		fields
	});
};

export const setPrimaryAuthIdentity = async ({
	db,
	identityId,
	userSub
}: {
	db: NeonHttpDatabase<SchemaType>;
	identityId: string;
	userSub: string;
}) => {
	const identity = await getDBAuthIdentityById({ db, id: identityId });
	if (identity === undefined || identity.user_sub !== userSub) {
		throw new Error('Auth identity not found');
	}

	await updateDBUser({
		userSub,
		db,
		fields: {
			primary_auth_identity_id: identity.id,
			...buildCanonicalUserFieldsFromIdentity({
				authProvider: identity.auth_provider,
				userIdentity: identity.metadata ?? {}
			})
		}
	});

	return identity;
};

export const mergeUserAccounts = async ({
	db,
	mergeRequestId,
	targetUserSub
}: {
	db: NeonHttpDatabase<SchemaType>;
	mergeRequestId: string;
	targetUserSub: string;
}) => {
	const mergeRequest = await getDBAuthIdentityMergeRequest({
		db,
		id: mergeRequestId
	});
	if (
		mergeRequest === undefined ||
		mergeRequest.target_user_sub !== targetUserSub ||
		mergeRequest.status !== 'pending'
	) {
		throw new Error('Merge request not found');
	}

	const [targetUser, sourceUser] = await Promise.all([
		getDBUser({ userSub: targetUserSub, db }),
		getDBUser({ userSub: mergeRequest.source_user_sub, db })
	]);
	if (targetUser === undefined || sourceUser === undefined) {
		throw new Error('Merge users not found');
	}

	const [targetIdentities, sourceIdentities] = await Promise.all([
		listDBAuthIdentitiesByUser({ db, userSub: targetUserSub }),
		listDBAuthIdentitiesByUser({
			db,
			userSub: mergeRequest.source_user_sub
		})
	]);
	const targetKeys = new Set(
		targetIdentities.map(
			(identity) =>
				`${identity.auth_provider}:${identity.provider_subject}`
		)
	);
	const conflictingIdentity = `${mergeRequest.conflicting_auth_provider}:${mergeRequest.conflicting_provider_subject}`;
	const duplicate = sourceIdentities.find((identity) => {
		const key = `${identity.auth_provider}:${identity.provider_subject}`;
		return key !== conflictingIdentity && targetKeys.has(key);
	});
	if (duplicate) {
		throw new Error(
			`Cannot merge accounts because ${duplicate.auth_provider}:${duplicate.provider_subject} is already linked to both users`
		);
	}

	if (sourceIdentities.length > 0) {
		await db
			.update(schema.authIdentities)
			.set({ user_sub: targetUserSub, updated_at: new Date() })
			.where(
				inArray(
					schema.authIdentities.id,
					sourceIdentities.map((identity) => identity.id)
				)
			);
	}

	await db
		.update(schema.linkedProviderGrants)
		.set({ owner_ref: targetUserSub, updated_at: new Date() })
		.where(
			eq(
				schema.linkedProviderGrants.owner_ref,
				mergeRequest.source_user_sub
			)
		);

	await db
		.delete(schema.users)
		.where(eq(schema.users.sub, mergeRequest.source_user_sub));

	await updateDBAuthIdentityMergeRequestStatus({
		db,
		id: mergeRequest.id,
		metadata: {
			mergedInto: targetUserSub,
			mergedSource: mergeRequest.source_user_sub
		},
		status: 'merged'
	});

	return mergeRequest;
};

export const createUser = async ({
	userIdentity,
	authProvider,
	db
}: UserFunctionProps<SchemaType>) => {
	const userSub = createAccountId();

	const user = await createDBUser({
		sub: userSub,
		db,
		primary_auth_identity_id: null,
		...buildCanonicalUserFieldsFromIdentity({
			authProvider,
			userIdentity
		})
	});

	const linkedIdentity = await linkUserIdentity({
		authProvider,
		db,
		userSub,
		userIdentity
	});

	await updateDBUserPrimaryAuthIdentity({
		userSub,
		db,
		primaryAuthIdentityId: linkedIdentity.identity.id
	});

	return getDBUser({ userSub, db }) ?? user;
};

export const getUserByIdentity = async ({
	userIdentity,
	authProvider,
	db
}: UserFunctionProps<SchemaType>) => {
	const providerSubject = buildProviderSubjectFromIdentity({
		authProvider,
		userIdentity
	});
	const identity = await getDBAuthIdentity({
		authProvider,
		db,
		providerSubject
	});

	if (identity !== undefined) {
		return getDBUser({ userSub: identity.user_sub, db });
	}

	return undefined;
};

export const getUser = getUserByIdentity;
