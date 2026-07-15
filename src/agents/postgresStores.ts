import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { bigint, jsonb, pgTable, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	AgentDelegation,
	AgentDelegationStatus,
	AgentDelegationStore,
	AgentRegistration,
	AgentRegistrationStatus,
	AgentRegistrationStore
} from './types';

const ID_LENGTH = 255;
const NAME_LENGTH = 255;
const STATUS_LENGTH = 16;

export const agentDelegationsTable = pgTable('auth_agent_delegations', {
	agent_id: varchar('agent_id', { length: ID_LENGTH }).notNull(),
	authorization_details: jsonb('authorization_details').$type<
		Record<string, unknown>[]
	>(),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	delegation_id: varchar('delegation_id', {
		length: ID_LENGTH
	}).primaryKey(),
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }),
	organization_id: varchar('organization_id', { length: ID_LENGTH }),
	scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
	status: varchar('status', { length: STATUS_LENGTH })
		.$type<AgentDelegationStatus>()
		.notNull(),
	updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull(),
	user_id: varchar('user_id', { length: ID_LENGTH }).notNull()
});
export const agentRegistrationsTable = pgTable('auth_agent_registrations', {
	agent_id: varchar('agent_id', { length: ID_LENGTH }).primaryKey(),
	allowed_scopes: jsonb('allowed_scopes')
		.$type<string[]>()
		.notNull()
		.default([]),
	client_id: varchar('client_id', { length: ID_LENGTH }).unique(),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	metadata: jsonb('metadata').$type<Record<string, unknown>>(),
	name: varchar('name', { length: NAME_LENGTH }).notNull(),
	status: varchar('status', { length: STATUS_LENGTH })
		.$type<AgentRegistrationStatus>()
		.notNull(),
	updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull()
});

type RegistrationRow = typeof agentRegistrationsTable.$inferSelect;
type RegistrationInsert = typeof agentRegistrationsTable.$inferInsert;
type DelegationRow = typeof agentDelegationsTable.$inferSelect;
type DelegationInsert = typeof agentDelegationsTable.$inferInsert;

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

export const createNeonAgentDelegationStore = (databaseUrl: string) =>
	createPostgresAgentDelegationStore(createNeonDatabase(databaseUrl));
export const createNeonAgentRegistrationStore = (databaseUrl: string) =>
	createPostgresAgentRegistrationStore(createNeonDatabase(databaseUrl));
export const createPostgresAgentDelegationStore = <DB extends AnyPgDatabase>(
	db: DB
): AgentDelegationStore => ({
	findActiveDelegation: async ({
		agentId,
		now = Date.now(),
		organizationId,
		userId
	}) => {
		const organizationCondition =
			organizationId === undefined
				? isNull(agentDelegationsTable.organization_id)
				: eq(agentDelegationsTable.organization_id, organizationId);
		const [row] = await db
			.select()
			.from(agentDelegationsTable)
			.where(
				and(
					eq(agentDelegationsTable.agent_id, agentId),
					eq(agentDelegationsTable.user_id, userId),
					organizationCondition,
					eq(agentDelegationsTable.status, 'active'),
					or(
						isNull(agentDelegationsTable.expires_at_ms),
						gt(agentDelegationsTable.expires_at_ms, now)
					)
				)
			)
			.orderBy(desc(agentDelegationsTable.updated_at_ms))
			.limit(1);

		return row === undefined ? undefined : toDelegation(row);
	},
	findByDelegationId: async (delegationId) => {
		const [row] = await db
			.select()
			.from(agentDelegationsTable)
			.where(eq(agentDelegationsTable.delegation_id, delegationId))
			.limit(1);

		return row === undefined ? undefined : toDelegation(row);
	},
	listDelegations: async (agentId) => {
		const base = db.select().from(agentDelegationsTable);
		const rows = await (agentId === undefined
			? base.orderBy(desc(agentDelegationsTable.created_at_ms))
			: base
					.where(eq(agentDelegationsTable.agent_id, agentId))
					.orderBy(desc(agentDelegationsTable.created_at_ms)));

		return rows.map(toDelegation);
	},
	saveDelegation: async (delegation) => {
		const values: DelegationInsert = {
			agent_id: delegation.agentId,
			authorization_details: delegation.authorizationDetails ?? null,
			created_at_ms: delegation.createdAt,
			delegation_id: delegation.delegationId,
			expires_at_ms: delegation.expiresAt ?? null,
			organization_id: delegation.organizationId ?? null,
			scopes: delegation.scopes,
			status: delegation.status,
			updated_at_ms: delegation.updatedAt,
			user_id: delegation.userId
		};
		await db
			.insert(agentDelegationsTable)
			.values(values)
			.onConflictDoUpdate({
				set: values,
				target: agentDelegationsTable.delegation_id
			});
	}
});
export const createPostgresAgentRegistrationStore = <DB extends AnyPgDatabase>(
	db: DB
): AgentRegistrationStore => ({
	findByAgentId: async (agentId) => {
		const [row] = await db
			.select()
			.from(agentRegistrationsTable)
			.where(eq(agentRegistrationsTable.agent_id, agentId))
			.limit(1);

		return row === undefined ? undefined : toRegistration(row);
	},
	findByClientId: async (clientId) => {
		const [row] = await db
			.select()
			.from(agentRegistrationsTable)
			.where(eq(agentRegistrationsTable.client_id, clientId))
			.limit(1);

		return row === undefined ? undefined : toRegistration(row);
	},
	listRegistrations: async () => {
		const rows = await db
			.select()
			.from(agentRegistrationsTable)
			.orderBy(desc(agentRegistrationsTable.created_at_ms));

		return rows.map(toRegistration);
	},
	saveRegistration: async (registration) => {
		const values: RegistrationInsert = {
			agent_id: registration.agentId,
			allowed_scopes: registration.allowedScopes,
			client_id: registration.clientId ?? null,
			created_at_ms: registration.createdAt,
			metadata: registration.metadata ?? null,
			name: registration.name,
			status: registration.status,
			updated_at_ms: registration.updatedAt
		};
		await db
			.insert(agentRegistrationsTable)
			.values(values)
			.onConflictDoUpdate({
				set: values,
				target: agentRegistrationsTable.agent_id
			});
	}
});
