import { and, eq } from 'drizzle-orm';
import { pgTable, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import { warrantKey } from './inMemoryStores';
import type { Warrant, WarrantStore } from './types';

const ID_LENGTH = 255;

export const warrantsTable = pgTable('auth_fga_warrants', {
	id: varchar('id', { length: ID_LENGTH }).primaryKey(),
	relation: varchar('relation', { length: ID_LENGTH }).notNull(),
	resource_id: varchar('resource_id', { length: ID_LENGTH }).notNull(),
	resource_type: varchar('resource_type', { length: ID_LENGTH }).notNull(),
	subject_id: varchar('subject_id', { length: ID_LENGTH }).notNull(),
	subject_relation: varchar('subject_relation', { length: ID_LENGTH }),
	subject_type: varchar('subject_type', { length: ID_LENGTH }).notNull()
});

type WarrantRow = typeof warrantsTable.$inferSelect;

const toWarrant = (row: WarrantRow): Warrant => ({
	relation: row.relation,
	resourceId: row.resource_id,
	resourceType: row.resource_type,
	subjectId: row.subject_id,
	subjectRelation: row.subject_relation ?? undefined,
	subjectType: row.subject_type
});

export const createNeonWarrantStore = (databaseUrl: string) =>
	createPostgresWarrantStore(createNeonDatabase(databaseUrl));
export const createPostgresWarrantStore = (db: AnyPgDatabase): WarrantStore => ({
	deleteWarrant: async (warrant) => {
		await db.delete(warrantsTable).where(eq(warrantsTable.id, warrantKey(warrant)));
	},
	listForResource: async (resourceType, resourceId, relation) => {
		const rows = await db
			.select()
			.from(warrantsTable)
			.where(
				and(
					eq(warrantsTable.resource_type, resourceType),
					eq(warrantsTable.resource_id, resourceId),
					eq(warrantsTable.relation, relation)
				)
			);

		return rows.map(toWarrant);
	},
	saveWarrant: async (warrant) => {
		await db
			.insert(warrantsTable)
			.values({
				id: warrantKey(warrant),
				relation: warrant.relation,
				resource_id: warrant.resourceId,
				resource_type: warrant.resourceType,
				subject_id: warrant.subjectId,
				subject_relation: warrant.subjectRelation ?? null,
				subject_type: warrant.subjectType
			})
			.onConflictDoNothing({ target: warrantsTable.id });
	}
});
