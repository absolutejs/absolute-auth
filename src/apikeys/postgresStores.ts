import { desc, eq, lt } from 'drizzle-orm';
import { bigint, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import {
	type AnyPgDatabase,
	type PgQueryResultHKT,
	type TablesRelationalConfig,
	createNeonDatabase
} from '../stores/postgres';
import type {
	AccessToken,
	AccessTokenStore,
	ApiClient,
	ApiClientStore,
	ApiKey,
	ApiKeyStore
} from './types';

const ID_LENGTH = 255;

export const accessTokensTable = pgTable('auth_access_tokens', {
	client_id: varchar('client_id', { length: ID_LENGTH }).notNull(),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
	hashed_token: varchar('hashed_token', { length: ID_LENGTH }).notNull(),
	owner_id: varchar('owner_id', { length: ID_LENGTH }),
	scopes: text('scopes').array().notNull(),
	token_id: varchar('token_id', { length: ID_LENGTH }).primaryKey()
});
export const apiClientsTable = pgTable('auth_api_clients', {
	client_id: varchar('client_id', { length: ID_LENGTH }).primaryKey(),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	hashed_secret: varchar('hashed_secret', { length: ID_LENGTH }).notNull(),
	name: varchar('name', { length: ID_LENGTH }).notNull(),
	owner_id: varchar('owner_id', { length: ID_LENGTH }),
	scopes: text('scopes').array().notNull()
});
export const apiKeysTable = pgTable('auth_api_keys', {
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }),
	hashed_key: varchar('hashed_key', { length: ID_LENGTH }).notNull(),
	key_id: varchar('key_id', { length: ID_LENGTH }).primaryKey(),
	last_used_at_ms: bigint('last_used_at_ms', { mode: 'number' }),
	name: varchar('name', { length: ID_LENGTH }).notNull(),
	owner_id: varchar('owner_id', { length: ID_LENGTH }),
	prefix: varchar('prefix', { length: ID_LENGTH }).notNull(),
	scopes: text('scopes').array().notNull()
});

type ApiKeyRow = typeof apiKeysTable.$inferSelect;
type ApiClientRow = typeof apiClientsTable.$inferSelect;
type AccessTokenRow = typeof accessTokensTable.$inferSelect;

const toKey = (row: ApiKeyRow): ApiKey => ({
	createdAt: row.created_at_ms,
	expiresAt: row.expires_at_ms ?? undefined,
	hashedKey: row.hashed_key,
	keyId: row.key_id,
	lastUsedAt: row.last_used_at_ms ?? undefined,
	name: row.name,
	ownerId: row.owner_id ?? undefined,
	prefix: row.prefix,
	scopes: row.scopes
});

const toKeyValues = (key: ApiKey): typeof apiKeysTable.$inferInsert => ({
	created_at_ms: key.createdAt,
	expires_at_ms: key.expiresAt ?? null,
	hashed_key: key.hashedKey,
	key_id: key.keyId,
	last_used_at_ms: key.lastUsedAt ?? null,
	name: key.name,
	owner_id: key.ownerId ?? null,
	prefix: key.prefix,
	scopes: key.scopes
});

const toClient = (row: ApiClientRow): ApiClient => ({
	clientId: row.client_id,
	createdAt: row.created_at_ms,
	hashedSecret: row.hashed_secret,
	name: row.name,
	ownerId: row.owner_id ?? undefined,
	scopes: row.scopes
});

const toClientValues = (
	client: ApiClient
): typeof apiClientsTable.$inferInsert => ({
	client_id: client.clientId,
	created_at_ms: client.createdAt,
	hashed_secret: client.hashedSecret,
	name: client.name,
	owner_id: client.ownerId ?? null,
	scopes: client.scopes
});

const toAccessToken = (row: AccessTokenRow): AccessToken => ({
	clientId: row.client_id,
	createdAt: row.created_at_ms,
	expiresAt: row.expires_at_ms,
	hashedToken: row.hashed_token,
	ownerId: row.owner_id ?? undefined,
	scopes: row.scopes,
	tokenId: row.token_id
});

const toAccessTokenValues = (
	token: AccessToken
): typeof accessTokensTable.$inferInsert => ({
	client_id: token.clientId,
	created_at_ms: token.createdAt,
	expires_at_ms: token.expiresAt,
	hashed_token: token.hashedToken,
	owner_id: token.ownerId ?? null,
	scopes: token.scopes,
	token_id: token.tokenId
});

export const createNeonAccessTokenStore = (databaseUrl: string) =>
	createPostgresAccessTokenStore(createNeonDatabase(databaseUrl));
export const createNeonApiClientStore = (databaseUrl: string) =>
	createPostgresApiClientStore(createNeonDatabase(databaseUrl));
export const createNeonApiKeyStore = (databaseUrl: string) =>
	createPostgresApiKeyStore(createNeonDatabase(databaseUrl));
export const createPostgresAccessTokenStore = <
	Q extends PgQueryResultHKT,
	TFullSchema extends Record<string, unknown>,
	TSchema extends TablesRelationalConfig
>(
	db: AnyPgDatabase<Q, TFullSchema, TSchema>
): AccessTokenStore => ({
	deleteExpired: async (now) => {
		await db
			.delete(accessTokensTable)
			.where(lt(accessTokensTable.expires_at_ms, now));
	},
	deleteToken: async (tokenId) => {
		await db
			.delete(accessTokensTable)
			.where(eq(accessTokensTable.token_id, tokenId));
	},
	findByHashedToken: async (hashedToken) => {
		const [row] = await db
			.select()
			.from(accessTokensTable)
			.where(eq(accessTokensTable.hashed_token, hashedToken))
			.limit(1);

		return row ? toAccessToken(row) : undefined;
	},
	saveToken: async (token) => {
		const values = toAccessTokenValues(token);
		await db.insert(accessTokensTable).values(values).onConflictDoUpdate({
			set: values,
			target: accessTokensTable.token_id
		});
	}
});
export const createPostgresApiClientStore = <
	Q extends PgQueryResultHKT,
	TFullSchema extends Record<string, unknown>,
	TSchema extends TablesRelationalConfig
>(
	db: AnyPgDatabase<Q, TFullSchema, TSchema>
): ApiClientStore => ({
	deleteClient: async (clientId) => {
		await db
			.delete(apiClientsTable)
			.where(eq(apiClientsTable.client_id, clientId));
	},
	findClient: async (clientId) => {
		const [row] = await db
			.select()
			.from(apiClientsTable)
			.where(eq(apiClientsTable.client_id, clientId))
			.limit(1);

		return row ? toClient(row) : undefined;
	},
	listClients: async (ownerId) => {
		const rows =
			ownerId === undefined
				? await db
						.select()
						.from(apiClientsTable)
						.orderBy(desc(apiClientsTable.created_at_ms))
				: await db
						.select()
						.from(apiClientsTable)
						.where(eq(apiClientsTable.owner_id, ownerId))
						.orderBy(desc(apiClientsTable.created_at_ms));

		return rows.map(toClient);
	},
	saveClient: async (client) => {
		const values = toClientValues(client);
		await db.insert(apiClientsTable).values(values).onConflictDoUpdate({
			set: values,
			target: apiClientsTable.client_id
		});
	}
});
export const createPostgresApiKeyStore = <
	Q extends PgQueryResultHKT,
	TFullSchema extends Record<string, unknown>,
	TSchema extends TablesRelationalConfig
>(
	db: AnyPgDatabase<Q, TFullSchema, TSchema>
): ApiKeyStore => ({
	deleteKey: async (keyId) => {
		await db.delete(apiKeysTable).where(eq(apiKeysTable.key_id, keyId));
	},
	findByHashedKey: async (hashedKey) => {
		const [row] = await db
			.select()
			.from(apiKeysTable)
			.where(eq(apiKeysTable.hashed_key, hashedKey))
			.limit(1);

		return row ? toKey(row) : undefined;
	},
	listKeys: async (ownerId) => {
		const rows =
			ownerId === undefined
				? await db
						.select()
						.from(apiKeysTable)
						.orderBy(desc(apiKeysTable.created_at_ms))
				: await db
						.select()
						.from(apiKeysTable)
						.where(eq(apiKeysTable.owner_id, ownerId))
						.orderBy(desc(apiKeysTable.created_at_ms));

		return rows.map(toKey);
	},
	saveKey: async (key) => {
		const values = toKeyValues(key);
		await db.insert(apiKeysTable).values(values).onConflictDoUpdate({
			set: values,
			target: apiKeysTable.key_id
		});
	},
	touchKey: async (keyId, lastUsedAt) => {
		await db
			.update(apiKeysTable)
			.set({ last_used_at_ms: lastUsedAt })
			.where(eq(apiKeysTable.key_id, keyId));
	}
});
