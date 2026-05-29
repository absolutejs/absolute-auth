import { desc, eq } from 'drizzle-orm';
import { bigint, pgTable, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { ScimToken, ScimTokenStore } from './types';

const ID_LENGTH = 255;

export const scimTokensTable = pgTable('auth_scim_tokens', {
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	hashed_token: varchar('hashed_token', { length: ID_LENGTH }).notNull(),
	last_used_at_ms: bigint('last_used_at_ms', { mode: 'number' }),
	organization_id: varchar('organization_id', {
		length: ID_LENGTH
	}).notNull(),
	token_id: varchar('token_id', { length: ID_LENGTH }).primaryKey()
});

type ScimTokenRow = typeof scimTokensTable.$inferSelect;
type ScimTokenInsert = typeof scimTokensTable.$inferInsert;

const toToken = (row: ScimTokenRow): ScimToken => ({
	createdAt: row.created_at_ms,
	hashedToken: row.hashed_token,
	lastUsedAt: row.last_used_at_ms ?? undefined,
	organizationId: row.organization_id,
	tokenId: row.token_id
});

const toValues = (token: ScimToken): ScimTokenInsert => ({
	created_at_ms: token.createdAt,
	hashed_token: token.hashedToken,
	last_used_at_ms: token.lastUsedAt ?? null,
	organization_id: token.organizationId,
	token_id: token.tokenId
});

export const createNeonScimTokenStore = (databaseUrl: string) =>
	createPostgresScimTokenStore(createNeonDatabase(databaseUrl));

export const createPostgresScimTokenStore = <DB extends AnyPgDatabase>(
	db: DB
): ScimTokenStore => ({
	deleteToken: async (tokenId) => {
		await db
			.delete(scimTokensTable)
			.where(eq(scimTokensTable.token_id, tokenId));
	},
	findByHashedToken: async (hashedToken) => {
		const [row] = await db
			.select()
			.from(scimTokensTable)
			.where(eq(scimTokensTable.hashed_token, hashedToken))
			.limit(1);

		return row ? toToken(row) : undefined;
	},
	listTokens: async (organizationId) => {
		const rows = await db
			.select()
			.from(scimTokensTable)
			.where(eq(scimTokensTable.organization_id, organizationId))
			.orderBy(desc(scimTokensTable.created_at_ms));

		return rows.map(toToken);
	},
	saveToken: async (token) => {
		const values = toValues(token);
		await db.insert(scimTokensTable).values(values).onConflictDoUpdate({
			set: values,
			target: scimTokensTable.token_id
		});
	}
});
