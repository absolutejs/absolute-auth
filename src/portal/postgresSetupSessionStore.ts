import { eq } from 'drizzle-orm';
import { bigint, jsonb, pgTable, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { SetupCapability, SetupSession, SetupSessionStore } from './types';

const ID_LENGTH = 255;

export const setupSessionsTable = pgTable('auth_setup_sessions', {
	capabilities: jsonb('capabilities')
		.$type<SetupCapability[]>()
		.notNull()
		.default([]),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	created_by: varchar('created_by', { length: ID_LENGTH }),
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
	organization_id: varchar('organization_id', {
		length: ID_LENGTH
	}).notNull(),
	setup_session_id: varchar('setup_session_id', {
		length: ID_LENGTH
	}).primaryKey(),
	token_hash: varchar('token_hash', { length: ID_LENGTH }).notNull().unique()
});

type SetupRow = typeof setupSessionsTable.$inferSelect;
type SetupInsert = typeof setupSessionsTable.$inferInsert;

const toSession = (row: SetupRow): SetupSession => ({
	capabilities: row.capabilities,
	createdAt: row.created_at_ms,
	createdBy: row.created_by ?? undefined,
	expiresAt: row.expires_at_ms,
	organizationId: row.organization_id,
	setupSessionId: row.setup_session_id,
	tokenHash: row.token_hash
});

export const createNeonSetupSessionStore = (databaseUrl: string) =>
	createPostgresSetupSessionStore(createNeonDatabase(databaseUrl));
export const createPostgresSetupSessionStore = <DB extends AnyPgDatabase>(
	db: DB
): SetupSessionStore => ({
	deleteSetupSession: async (setupSessionId) => {
		await db
			.delete(setupSessionsTable)
			.where(eq(setupSessionsTable.setup_session_id, setupSessionId));
	},
	getSetupSessionByTokenHash: async (tokenHash) => {
		const [row] = await db
			.select()
			.from(setupSessionsTable)
			.where(eq(setupSessionsTable.token_hash, tokenHash))
			.limit(1);

		return row ? toSession(row) : undefined;
	},
	saveSetupSession: async (session) => {
		const values: SetupInsert = {
			capabilities: session.capabilities,
			created_at_ms: session.createdAt,
			created_by: session.createdBy ?? null,
			expires_at_ms: session.expiresAt,
			organization_id: session.organizationId,
			setup_session_id: session.setupSessionId,
			token_hash: session.tokenHash
		};
		await db.insert(setupSessionsTable).values(values).onConflictDoUpdate({
			set: values,
			target: setupSessionsTable.setup_session_id
		});
	}
});
