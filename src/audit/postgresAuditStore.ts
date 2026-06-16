import { desc, eq, lt } from 'drizzle-orm';
import { bigint, jsonb, pgTable, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { AuditEvent, AuditEventType, AuditSink } from './types';

const ID_LENGTH = 255;
const IP_LENGTH = 64;
const TYPE_LENGTH = 64;
const DEFAULT_AUDIT_LIMIT = 100;

export const auditEventsTable = pgTable('auth_audit_events', {
	at_ms: bigint('at_ms', { mode: 'number' }).notNull(),
	id: varchar('id', { length: ID_LENGTH }).primaryKey(),
	ip: varchar('ip', { length: IP_LENGTH }),
	metadata_json: jsonb('metadata_json').$type<Record<string, unknown>>(),
	organization_id: varchar('organization_id', { length: ID_LENGTH }),
	type: varchar('type', { length: TYPE_LENGTH }).notNull(),
	user_id: varchar('user_id', { length: ID_LENGTH })
});

type AuditRow = typeof auditEventsTable.$inferSelect;

const toEvent = (row: AuditRow): AuditEvent => ({
	at: row.at_ms,
	ip: row.ip ?? undefined,
	metadata: row.metadata_json ?? undefined,
	organizationId: row.organization_id ?? undefined,
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- deserialization boundary: `type` was persisted from AuditEventType, so reading it back is sound
	type: row.type as AuditEventType,
	userId: row.user_id ?? undefined
});

export const createNeonAuditSink = (databaseUrl: string) =>
	createPostgresAuditSink(createNeonDatabase(databaseUrl));
export const createPostgresAuditSink = <DB extends AnyPgDatabase>(
	db: DB
): AuditSink => ({
	append: async (event) => {
		await db.insert(auditEventsTable).values({
			at_ms: event.at,
			id: crypto.randomUUID(),
			ip: event.ip ?? null,
			metadata_json: event.metadata ?? null,
			organization_id: event.organizationId ?? null,
			type: event.type,
			user_id: event.userId ?? null
		});
	},
	list: async (filter) => {
		const rows = await db
			.select()
			.from(auditEventsTable)
			.where(
				filter?.userId
					? eq(auditEventsTable.user_id, filter.userId)
					: undefined
			)
			.orderBy(desc(auditEventsTable.at_ms))
			.limit(filter?.limit ?? DEFAULT_AUDIT_LIMIT);

		return rows.map(toEvent);
	},
	prune: async (before) => {
		const deleted = await db
			.delete(auditEventsTable)
			.where(lt(auditEventsTable.at_ms, before))
			.returning({ id: auditEventsTable.id });

		return deleted.length;
	}
});
