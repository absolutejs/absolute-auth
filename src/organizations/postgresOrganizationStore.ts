import { and, eq } from 'drizzle-orm';
import {
	bigint,
	jsonb,
	pgTable,
	primaryKey,
	varchar
} from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	InvitationState,
	MembershipStatus,
	Organization,
	OrganizationInvitation,
	OrganizationMembership,
	OrganizationStore
} from './types';

const ID_LENGTH = 255;
const NAME_LENGTH = 255;
const STATE_LENGTH = 16;

export const organizationInvitationsTable = pgTable(
	'auth_organization_invitations',
	{
		accepted_at_ms: bigint('accepted_at_ms', { mode: 'number' }),
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		email: varchar('email', { length: ID_LENGTH }).notNull(),
		expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
		invitation_id: varchar('invitation_id', {
			length: ID_LENGTH
		}).primaryKey(),
		inviter_user_id: varchar('inviter_user_id', { length: ID_LENGTH }),
		organization_id: varchar('organization_id', {
			length: ID_LENGTH
		}).notNull(),
		roles: jsonb('roles').$type<string[]>().notNull().default([]),
		state: varchar('state', { length: STATE_LENGTH })
			.$type<InvitationState>()
			.notNull()
			.default('pending'),
		token_hash: varchar('token_hash', { length: ID_LENGTH })
			.notNull()
			.unique()
	}
);
export const organizationMembershipsTable = pgTable(
	'auth_organization_memberships',
	{
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		organization_id: varchar('organization_id', {
			length: ID_LENGTH
		}).notNull(),
		roles: jsonb('roles').$type<string[]>().notNull().default([]),
		status: varchar('status', { length: STATE_LENGTH })
			.$type<MembershipStatus>()
			.notNull()
			.default('active'),
		updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull(),
		user_id: varchar('user_id', { length: ID_LENGTH }).notNull()
	},
	(table) => [primaryKey({ columns: [table.organization_id, table.user_id] })]
);
export const organizationsTable = pgTable('auth_organizations', {
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	metadata: jsonb('metadata').$type<Record<string, unknown>>(),
	name: varchar('name', { length: NAME_LENGTH }).notNull(),
	organization_id: varchar('organization_id', {
		length: ID_LENGTH
	}).primaryKey(),
	updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull()
});

type OrganizationRow = typeof organizationsTable.$inferSelect;
type MembershipRow = typeof organizationMembershipsTable.$inferSelect;
type InvitationRow = typeof organizationInvitationsTable.$inferSelect;
type OrganizationInsert = typeof organizationsTable.$inferInsert;
type MembershipInsert = typeof organizationMembershipsTable.$inferInsert;
type InvitationInsert = typeof organizationInvitationsTable.$inferInsert;

const toOrganization = (row: OrganizationRow): Organization => ({
	createdAt: row.created_at_ms,
	metadata: row.metadata ?? undefined,
	name: row.name,
	organizationId: row.organization_id,
	updatedAt: row.updated_at_ms
});

const toMembership = (row: MembershipRow): OrganizationMembership => ({
	createdAt: row.created_at_ms,
	organizationId: row.organization_id,
	roles: row.roles,
	status: row.status,
	updatedAt: row.updated_at_ms,
	userId: row.user_id
});

const toInvitation = (row: InvitationRow): OrganizationInvitation => ({
	acceptedAt: row.accepted_at_ms ?? undefined,
	createdAt: row.created_at_ms,
	email: row.email,
	expiresAt: row.expires_at_ms,
	invitationId: row.invitation_id,
	inviterUserId: row.inviter_user_id ?? undefined,
	organizationId: row.organization_id,
	roles: row.roles,
	state: row.state,
	tokenHash: row.token_hash
});

export const createNeonOrganizationStore = (databaseUrl: string) =>
	createPostgresOrganizationStore(createNeonDatabase(databaseUrl));
export const createPostgresOrganizationStore = <DB extends AnyPgDatabase>(
	db: DB
): OrganizationStore => ({
	deleteOrganization: async (organizationId) => {
		await db
			.delete(organizationsTable)
			.where(eq(organizationsTable.organization_id, organizationId));
	},
	getInvitation: async (invitationId) => {
		const [row] = await db
			.select()
			.from(organizationInvitationsTable)
			.where(eq(organizationInvitationsTable.invitation_id, invitationId))
			.limit(1);

		return row ? toInvitation(row) : undefined;
	},
	getInvitationByTokenHash: async (tokenHash) => {
		const [row] = await db
			.select()
			.from(organizationInvitationsTable)
			.where(eq(organizationInvitationsTable.token_hash, tokenHash))
			.limit(1);

		return row ? toInvitation(row) : undefined;
	},
	getMembership: async (organizationId, userId) => {
		const [row] = await db
			.select()
			.from(organizationMembershipsTable)
			.where(
				and(
					eq(
						organizationMembershipsTable.organization_id,
						organizationId
					),
					eq(organizationMembershipsTable.user_id, userId)
				)
			)
			.limit(1);

		return row ? toMembership(row) : undefined;
	},
	getOrganization: async (organizationId) => {
		const [row] = await db
			.select()
			.from(organizationsTable)
			.where(eq(organizationsTable.organization_id, organizationId))
			.limit(1);

		return row ? toOrganization(row) : undefined;
	},
	listInvitationsByOrganization: async (organizationId) => {
		const rows = await db
			.select()
			.from(organizationInvitationsTable)
			.where(
				eq(organizationInvitationsTable.organization_id, organizationId)
			);

		return rows.map(toInvitation);
	},
	listMembershipsByOrganization: async (organizationId) => {
		const rows = await db
			.select()
			.from(organizationMembershipsTable)
			.where(
				eq(organizationMembershipsTable.organization_id, organizationId)
			);

		return rows.map(toMembership);
	},
	listMembershipsByUser: async (userId) => {
		const rows = await db
			.select()
			.from(organizationMembershipsTable)
			.where(eq(organizationMembershipsTable.user_id, userId));

		return rows.map(toMembership);
	},
	removeMembership: async (organizationId, userId) => {
		await db
			.delete(organizationMembershipsTable)
			.where(
				and(
					eq(
						organizationMembershipsTable.organization_id,
						organizationId
					),
					eq(organizationMembershipsTable.user_id, userId)
				)
			);
	},
	saveInvitation: async (invitation) => {
		const values: InvitationInsert = {
			accepted_at_ms: invitation.acceptedAt ?? null,
			created_at_ms: invitation.createdAt,
			email: invitation.email,
			expires_at_ms: invitation.expiresAt,
			invitation_id: invitation.invitationId,
			inviter_user_id: invitation.inviterUserId ?? null,
			organization_id: invitation.organizationId,
			roles: invitation.roles,
			state: invitation.state,
			token_hash: invitation.tokenHash
		};
		await db
			.insert(organizationInvitationsTable)
			.values(values)
			.onConflictDoUpdate({
				set: values,
				target: organizationInvitationsTable.invitation_id
			});
	},
	saveMembership: async (membership) => {
		const values: MembershipInsert = {
			created_at_ms: membership.createdAt,
			organization_id: membership.organizationId,
			roles: membership.roles,
			status: membership.status,
			updated_at_ms: membership.updatedAt,
			user_id: membership.userId
		};
		await db
			.insert(organizationMembershipsTable)
			.values(values)
			.onConflictDoUpdate({
				set: values,
				target: [
					organizationMembershipsTable.organization_id,
					organizationMembershipsTable.user_id
				]
			});
	},
	saveOrganization: async (organization) => {
		const values: OrganizationInsert = {
			created_at_ms: organization.createdAt,
			metadata: organization.metadata ?? null,
			name: organization.name,
			organization_id: organization.organizationId,
			updated_at_ms: organization.updatedAt
		};
		await db.insert(organizationsTable).values(values).onConflictDoUpdate({
			set: values,
			target: organizationsTable.organization_id
		});
	}
});
