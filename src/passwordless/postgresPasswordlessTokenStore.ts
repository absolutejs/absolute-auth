import { eq } from 'drizzle-orm';
import { bigint, pgTable, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { PasswordlessToken, PasswordlessTokenStore } from './types';

const ID_LENGTH = 255;

export const passwordlessTokensTable = pgTable('auth_passwordless_tokens', {
	email: varchar('email', { length: ID_LENGTH }).notNull(),
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
	token_hash: varchar('token_hash', { length: ID_LENGTH }).primaryKey()
});

type PasswordlessRow = typeof passwordlessTokensTable.$inferSelect;
type PasswordlessInsert = typeof passwordlessTokensTable.$inferInsert;

const toToken = (row: PasswordlessRow): PasswordlessToken => ({
	email: row.email,
	expiresAt: row.expires_at_ms,
	tokenHash: row.token_hash
});

export const createNeonPasswordlessTokenStore = (databaseUrl: string) =>
	createPostgresPasswordlessTokenStore(createNeonDatabase(databaseUrl));
export const createPostgresPasswordlessTokenStore = <DB extends AnyPgDatabase>(
	db: DB
): PasswordlessTokenStore => ({
	consumeToken: async (tokenHash) => {
		const [row] = await db
			.delete(passwordlessTokensTable)
			.where(eq(passwordlessTokensTable.token_hash, tokenHash))
			.returning();

		return row ? toToken(row) : undefined;
	},
	saveToken: async (token) => {
		const values: PasswordlessInsert = {
			email: token.email,
			expires_at_ms: token.expiresAt,
			token_hash: token.tokenHash
		};
		await db
			.insert(passwordlessTokensTable)
			.values(values)
			.onConflictDoUpdate({
				set: values,
				target: passwordlessTokensTable.token_hash
			});
	}
});
