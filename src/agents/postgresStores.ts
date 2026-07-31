import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import {
	bigint,
	customType,
	integer,
	pgTable,
	uniqueIndex,
	varchar
} from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	AgentDelegation,
	AgentDelegationStatus,
	AgentDelegationStore,
	AgentIdentityRegistration,
	AgentIdentityRegistrationKind,
	AgentIdentityRegistrationStatus,
	AgentIdentityRegistrationStore,
	AgentRegistration,
	AgentRegistrationStatus,
	AgentRegistrationStore
} from './types';

const ID_LENGTH = 255;
const NAME_LENGTH = 255;
const STATUS_LENGTH = 16;

// Drizzle 1.0's built-in JSONB codec is not yet serialized by Bun SQL. This
// package-owned custom type preserves one portable boundary for Bun SQL,
// postgres.js, and Neon while `$type<T>()` retains each column's exact shape.
const portableJsonb = customType<{ data: unknown; driverData: unknown }>({
	dataType: () => 'jsonb',
	fromDriver: (value) =>
		typeof value === 'string' ? JSON.parse(value) : value,
	toDriver: (value) => JSON.stringify(value)
});
const bunSqlJsonb = customType<{ data: unknown; driverData: unknown }>({
	dataType: () => 'jsonb',
	fromDriver: (value) =>
		typeof value === 'string' ? JSON.parse(value) : value,
	toDriver: (value) => value
});
type JsonbFactory = (name: string) => ReturnType<typeof portableJsonb>;
const createAgentDelegationsTable = (json: JsonbFactory) =>
	pgTable('auth_agent_delegations', {
		agent_id: varchar('agent_id', { length: ID_LENGTH }).notNull(),
		authorization_details: json('authorization_details').$type<
			Record<string, unknown>[]
		>(),
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		delegation_id: varchar('delegation_id', {
			length: ID_LENGTH
		}).primaryKey(),
		expires_at_ms: bigint('expires_at_ms', { mode: 'number' }),
		organization_id: varchar('organization_id', { length: ID_LENGTH }),
		scopes: json('scopes').$type<string[]>().notNull().default([]),
		status: varchar('status', { length: STATUS_LENGTH })
			.$type<AgentDelegationStatus>()
			.notNull(),
		updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull(),
		user_id: varchar('user_id', { length: ID_LENGTH }).notNull()
	});
const createAgentIdentityRegistrationsTable = (json: JsonbFactory) =>
	pgTable(
		'auth_agent_identity_registrations',
		{
			agent_id: varchar('agent_id', { length: ID_LENGTH })
				.notNull()
				.unique(),
			claim_attempt:
				json('claim_attempt').$type<
					AgentIdentityRegistration['claimAttempt']
				>(),
			claim_attempt_token_hash: varchar('claim_attempt_token_hash', {
				length: ID_LENGTH
			}).unique(),
			claim_expires_at_ms: bigint('claim_expires_at_ms', {
				mode: 'number'
			}).notNull(),
			claim_token_hash: varchar('claim_token_hash', {
				length: ID_LENGTH
			})
				.notNull()
				.unique(),
			created_at_ms: bigint('created_at_ms', {
				mode: 'number'
			}).notNull(),
			expires_at_ms: bigint('expires_at_ms', {
				mode: 'number'
			}).notNull(),
			kind: varchar('kind', { length: 32 })
				.$type<AgentIdentityRegistrationKind>()
				.notNull(),
			last_polled_at_ms: bigint('last_polled_at_ms', { mode: 'number' }),
			login_hint: varchar('login_hint', { length: ID_LENGTH }),
			registration_id: varchar('registration_id', {
				length: ID_LENGTH
			}).primaryKey(),
			status: varchar('status', { length: STATUS_LENGTH })
				.$type<AgentIdentityRegistrationStatus>()
				.notNull(),
			updated_at_ms: bigint('updated_at_ms', {
				mode: 'number'
			}).notNull(),
			upstream_client_id: varchar('upstream_client_id', {
				length: ID_LENGTH
			}),
			upstream_issuer: varchar('upstream_issuer', { length: ID_LENGTH }),
			upstream_subject: varchar('upstream_subject', {
				length: ID_LENGTH
			}),
			user_id: varchar('user_id', { length: ID_LENGTH }),
			version: integer('version').notNull()
		},
		(table) => [
			uniqueIndex('auth_agent_identity_upstream_unique').on(
				table.upstream_issuer,
				table.upstream_subject,
				table.upstream_client_id
			)
		]
	);
const createAgentRegistrationsTable = (json: JsonbFactory) =>
	pgTable('auth_agent_registrations', {
		agent_id: varchar('agent_id', { length: ID_LENGTH }).primaryKey(),
		allowed_scopes: json('allowed_scopes')
			.$type<string[]>()
			.notNull()
			.default([]),
		client_id: varchar('client_id', { length: ID_LENGTH }).unique(),
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		metadata: json('metadata').$type<Record<string, unknown>>(),
		name: varchar('name', { length: NAME_LENGTH }).notNull(),
		status: varchar('status', { length: STATUS_LENGTH })
			.$type<AgentRegistrationStatus>()
			.notNull(),
		updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull()
	});

/** Bun SQL mappings for server-described native JSONB parameters. */
export const agentDelegationsBunSqlTable =
	createAgentDelegationsTable(bunSqlJsonb);
export const agentDelegationsTable = createAgentDelegationsTable(portableJsonb);
export const agentIdentityRegistrationsBunSqlTable =
	createAgentIdentityRegistrationsTable(bunSqlJsonb);
export const agentIdentityRegistrationsTable =
	createAgentIdentityRegistrationsTable(portableJsonb);
export const agentRegistrationsBunSqlTable =
	createAgentRegistrationsTable(bunSqlJsonb);
export const agentRegistrationsTable =
	createAgentRegistrationsTable(portableJsonb);

type RegistrationRow = typeof agentRegistrationsTable.$inferSelect;
type DelegationRow = typeof agentDelegationsTable.$inferSelect;
type IdentityRegistrationRow =
	typeof agentIdentityRegistrationsTable.$inferSelect;

const toRegistration = (row: RegistrationRow): AgentRegistration => ({
	agentId: row.agent_id,
	allowedScopes: row.allowed_scopes,
	clientId: row.client_id ?? undefined,
	createdAt: row.created_at_ms,
	metadata: row.metadata ?? undefined,
	name: row.name,
	status: row.status,
	updatedAt: row.updated_at_ms
});

const toDelegation = (row: DelegationRow): AgentDelegation => ({
	agentId: row.agent_id,
	authorizationDetails: row.authorization_details ?? undefined,
	createdAt: row.created_at_ms,
	delegationId: row.delegation_id,
	expiresAt: row.expires_at_ms ?? undefined,
	organizationId: row.organization_id ?? undefined,
	scopes: row.scopes,
	status: row.status,
	updatedAt: row.updated_at_ms,
	userId: row.user_id
});

const toIdentityRegistration = (
	row: IdentityRegistrationRow
): AgentIdentityRegistration => ({
	agentId: row.agent_id,
	claimAttempt: row.claim_attempt ?? undefined,
	claimExpiresAt: row.claim_expires_at_ms,
	claimTokenHash: row.claim_token_hash,
	createdAt: row.created_at_ms,
	expiresAt: row.expires_at_ms,
	kind: row.kind,
	lastPolledAt: row.last_polled_at_ms ?? undefined,
	loginHint: row.login_hint ?? undefined,
	registrationId: row.registration_id,
	status: row.status,
	updatedAt: row.updated_at_ms,
	upstream:
		row.upstream_client_id === null ||
		row.upstream_issuer === null ||
		row.upstream_subject === null
			? undefined
			: {
					clientId: row.upstream_client_id,
					issuer: row.upstream_issuer,
					subject: row.upstream_subject
				},
	userId: row.user_id ?? undefined,
	version: row.version
});

const identityRegistrationValues = (
	registration: AgentIdentityRegistration
) => ({
	agent_id: registration.agentId,
	claim_attempt:
		registration.claimAttempt === undefined
			? null
			: registration.claimAttempt,
	claim_attempt_token_hash: registration.claimAttempt?.tokenHash ?? null,
	claim_expires_at_ms: registration.claimExpiresAt,
	claim_token_hash: registration.claimTokenHash,
	created_at_ms: registration.createdAt,
	expires_at_ms: registration.expiresAt,
	kind: registration.kind,
	last_polled_at_ms: registration.lastPolledAt ?? null,
	login_hint: registration.loginHint ?? null,
	registration_id: registration.registrationId,
	status: registration.status,
	updated_at_ms: registration.updatedAt,
	upstream_client_id: registration.upstream?.clientId ?? null,
	upstream_issuer: registration.upstream?.issuer ?? null,
	upstream_subject: registration.upstream?.subject ?? null,
	user_id: registration.userId ?? null,
	version: registration.version
});

export const createNeonAgentDelegationStore = (databaseUrl: string) =>
	createDrizzleAgentDelegationStore(createNeonDatabase(databaseUrl));
export const createNeonAgentIdentityRegistrationStore = (databaseUrl: string) =>
	createPostgresAgentIdentityRegistrationStore(
		createNeonDatabase(databaseUrl)
	);
export const createNeonAgentRegistrationStore = (databaseUrl: string) =>
	createPostgresAgentRegistrationStore(createNeonDatabase(databaseUrl));
const createDrizzleAgentDelegationStoreFor = <DB extends AnyPgDatabase>(
	db: DB,
	table: typeof agentDelegationsTable
): AgentDelegationStore => ({
	findActiveDelegation: async ({
		agentId,
		now = Date.now(),
		organizationId,
		userId
	}) => {
		const organizationCondition =
			organizationId === undefined
				? isNull(table.organization_id)
				: eq(table.organization_id, organizationId);
		const [row] = await db
			.select()
			.from(table)
			.where(
				and(
					eq(table.agent_id, agentId),
					eq(table.user_id, userId),
					organizationCondition,
					eq(table.status, 'active'),
					or(
						isNull(table.expires_at_ms),
						gt(table.expires_at_ms, now)
					)
				)
			)
			.orderBy(desc(table.updated_at_ms))
			.limit(1);

		return row === undefined ? undefined : toDelegation(row);
	},
	findByDelegationId: async (delegationId) => {
		const [row] = await db
			.select()
			.from(table)
			.where(eq(table.delegation_id, delegationId))
			.limit(1);

		return row === undefined ? undefined : toDelegation(row);
	},
	listDelegations: async (agentId) => {
		const base = db.select().from(table);
		const rows = await (agentId === undefined
			? base.orderBy(desc(table.created_at_ms))
			: base
					.where(eq(table.agent_id, agentId))
					.orderBy(desc(table.created_at_ms)));

		return rows.map(toDelegation);
	},
	saveDelegation: async (delegation) => {
		const values: typeof table.$inferInsert = {
			agent_id: delegation.agentId,
			authorization_details:
				delegation.authorizationDetails === undefined
					? null
					: delegation.authorizationDetails,
			created_at_ms: delegation.createdAt,
			delegation_id: delegation.delegationId,
			expires_at_ms: delegation.expiresAt ?? null,
			organization_id: delegation.organizationId ?? null,
			scopes: delegation.scopes,
			status: delegation.status,
			updated_at_ms: delegation.updatedAt,
			user_id: delegation.userId
		};
		await db.insert(table).values(values).onConflictDoUpdate({
			set: values,
			target: table.delegation_id
		});
	}
});
export const createDrizzleAgentDelegationStore = <DB extends AnyPgDatabase>(
	db: DB
) => createDrizzleAgentDelegationStoreFor(db, agentDelegationsTable);
export const createBunSqlDrizzleAgentDelegationStore = <
	DB extends AnyPgDatabase
>(
	db: DB
) => createDrizzleAgentDelegationStoreFor(db, agentDelegationsBunSqlTable);
/** @deprecated Use createDrizzleAgentDelegationStore. */
export const createPostgresAgentDelegationStore =
	createDrizzleAgentDelegationStore;
const createPostgresAgentIdentityRegistrationStoreFor = <
	DB extends AnyPgDatabase
>(
	db: DB,
	table: typeof agentIdentityRegistrationsTable
): AgentIdentityRegistrationStore => ({
	create: async (registration) => {
		const rows = await db
			.insert(table)
			.values(identityRegistrationValues(registration))
			.onConflictDoNothing()
			.returning({ id: table.registration_id });

		return rows.length === 1;
	},
	findByAgentId: async (agentId) => {
		const [row] = await db
			.select()
			.from(table)
			.where(eq(table.agent_id, agentId))
			.limit(1);

		return row === undefined ? undefined : toIdentityRegistration(row);
	},
	findByAttemptTokenHash: async (attemptTokenHash) => {
		const [row] = await db
			.select()
			.from(table)
			.where(eq(table.claim_attempt_token_hash, attemptTokenHash))
			.limit(1);

		return row === undefined ? undefined : toIdentityRegistration(row);
	},
	findByClaimTokenHash: async (claimTokenHash) => {
		const [row] = await db
			.select()
			.from(table)
			.where(eq(table.claim_token_hash, claimTokenHash))
			.limit(1);

		return row === undefined ? undefined : toIdentityRegistration(row);
	},
	findByRegistrationId: async (registrationId) => {
		const [row] = await db
			.select()
			.from(table)
			.where(eq(table.registration_id, registrationId))
			.limit(1);

		return row === undefined ? undefined : toIdentityRegistration(row);
	},
	findByUpstreamIdentity: async ({ clientId, issuer, subject }) => {
		const [row] = await db
			.select()
			.from(table)
			.where(
				and(
					eq(table.upstream_client_id, clientId),
					eq(table.upstream_issuer, issuer),
					eq(table.upstream_subject, subject)
				)
			)
			.limit(1);

		return row === undefined ? undefined : toIdentityRegistration(row);
	},
	replace: async (registration, expectedVersion) => {
		const next: AgentIdentityRegistration = {
			...registration,
			version: expectedVersion + 1
		};
		const values = identityRegistrationValues(next);
		const rows = await db
			.update(table)
			.set(values)
			.where(
				and(
					eq(table.registration_id, registration.registrationId),
					eq(table.version, expectedVersion)
				)
			)
			.returning({ id: table.registration_id });

		return rows.length === 1;
	}
});
export const createBunSqlDrizzleAgentIdentityRegistrationStore = <
	DB extends AnyPgDatabase
>(
	db: DB
) =>
	createPostgresAgentIdentityRegistrationStoreFor(
		db,
		agentIdentityRegistrationsBunSqlTable
	);
export const createPostgresAgentIdentityRegistrationStore = <
	DB extends AnyPgDatabase
>(
	db: DB
) =>
	createPostgresAgentIdentityRegistrationStoreFor(
		db,
		agentIdentityRegistrationsTable
	);
const createPostgresAgentRegistrationStoreFor = <DB extends AnyPgDatabase>(
	db: DB,
	table: typeof agentRegistrationsTable
): AgentRegistrationStore => ({
	findByAgentId: async (agentId) => {
		const [row] = await db
			.select()
			.from(table)
			.where(eq(table.agent_id, agentId))
			.limit(1);

		return row === undefined ? undefined : toRegistration(row);
	},
	findByClientId: async (clientId) => {
		const [row] = await db
			.select()
			.from(table)
			.where(eq(table.client_id, clientId))
			.limit(1);

		return row === undefined ? undefined : toRegistration(row);
	},
	listRegistrations: async () => {
		const rows = await db
			.select()
			.from(table)
			.orderBy(desc(table.created_at_ms));

		return rows.map(toRegistration);
	},
	saveRegistration: async (registration) => {
		const values: typeof table.$inferInsert = {
			agent_id: registration.agentId,
			allowed_scopes: registration.allowedScopes,
			client_id: registration.clientId ?? null,
			created_at_ms: registration.createdAt,
			metadata:
				registration.metadata === undefined
					? null
					: registration.metadata,
			name: registration.name,
			status: registration.status,
			updated_at_ms: registration.updatedAt
		};
		await db.insert(table).values(values).onConflictDoUpdate({
			set: values,
			target: table.agent_id
		});
	}
});
export const createBunSqlDrizzleAgentRegistrationStore = <
	DB extends AnyPgDatabase
>(
	db: DB
) => createPostgresAgentRegistrationStoreFor(db, agentRegistrationsBunSqlTable);
export const createPostgresAgentRegistrationStore = <DB extends AnyPgDatabase>(
	db: DB
) => createPostgresAgentRegistrationStoreFor(db, agentRegistrationsTable);
