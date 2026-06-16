import { and, eq } from 'drizzle-orm';
import {
	bigint,
	jsonb,
	pgTable,
	primaryKey,
	varchar
} from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { Role, RoleStore } from './types';

const ID_LENGTH = 255;
const SLUG_LENGTH = 128;
// Global roles (no organizationId) live under the empty-string scope so the composite PK stays
// NOT NULL (a real organizationId is never the empty string).
const GLOBAL_SCOPE = '';

export const rolesTable = pgTable(
	'auth_roles',
	{
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		organization_id: varchar('organization_id', { length: ID_LENGTH })
			.notNull()
			.default(GLOBAL_SCOPE),
		permissions: jsonb('permissions')
			.$type<string[]>()
			.notNull()
			.default([]),
		slug: varchar('slug', { length: SLUG_LENGTH }).notNull(),
		updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.organization_id, table.slug] })]
);

type RoleRow = typeof rolesTable.$inferSelect;
type RoleInsert = typeof rolesTable.$inferInsert;

const toRole = (row: RoleRow): Role => ({
	createdAt: row.created_at_ms,
	organizationId:
		row.organization_id === GLOBAL_SCOPE ? undefined : row.organization_id,
	permissions: row.permissions,
	slug: row.slug,
	updatedAt: row.updated_at_ms
});

export const createNeonRoleStore = (databaseUrl: string) =>
	createPostgresRoleStore(createNeonDatabase(databaseUrl));
export const createPostgresRoleStore = <DB extends AnyPgDatabase>(
	db: DB
): RoleStore => ({
	deleteRole: async (slug, organizationId) => {
		await db
			.delete(rolesTable)
			.where(
				and(
					eq(
						rolesTable.organization_id,
						organizationId ?? GLOBAL_SCOPE
					),
					eq(rolesTable.slug, slug)
				)
			);
	},
	getRole: async (slug, organizationId) => {
		const [row] = await db
			.select()
			.from(rolesTable)
			.where(
				and(
					eq(
						rolesTable.organization_id,
						organizationId ?? GLOBAL_SCOPE
					),
					eq(rolesTable.slug, slug)
				)
			)
			.limit(1);

		return row ? toRole(row) : undefined;
	},
	listRoles: async (organizationId) => {
		const rows = await db
			.select()
			.from(rolesTable)
			.where(
				eq(rolesTable.organization_id, organizationId ?? GLOBAL_SCOPE)
			);

		return rows.map(toRole);
	},
	saveRole: async (role) => {
		const values: RoleInsert = {
			created_at_ms: role.createdAt,
			organization_id: role.organizationId ?? GLOBAL_SCOPE,
			permissions: role.permissions,
			slug: role.slug,
			updated_at_ms: role.updatedAt
		};
		await db
			.insert(rolesTable)
			.values(values)
			.onConflictDoUpdate({
				set: values,
				target: [rolesTable.organization_id, rolesTable.slug]
			});
	}
});
