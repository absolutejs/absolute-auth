import { eq } from 'drizzle-orm';
import { bigint, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	AuthorizationCode,
	AuthorizationCodeStore,
	OAuthClient,
	OAuthClientStore,
	OidcRefreshToken,
	OidcRefreshTokenStore
} from './types';

const ID_LENGTH = 255;

export const oauthClientsTable = pgTable('auth_oauth_clients', {
	client_id: varchar('client_id', { length: ID_LENGTH }).primaryKey(),
	hashed_secret: varchar('hashed_secret', { length: ID_LENGTH }),
	name: varchar('name', { length: ID_LENGTH }).notNull(),
	redirect_uris: text('redirect_uris').array().notNull(),
	scopes: text('scopes').array().notNull()
});

export const oauthCodesTable = pgTable('auth_oauth_codes', {
	claims_json: jsonb('claims_json').$type<Record<string, unknown>>(),
	client_id: varchar('client_id', { length: ID_LENGTH }).notNull(),
	code_challenge: varchar('code_challenge', { length: ID_LENGTH }).notNull(),
	code_hash: varchar('code_hash', { length: ID_LENGTH }).primaryKey(),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	dpop_jkt: varchar('dpop_jkt', { length: ID_LENGTH }),
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
	nonce: varchar('nonce', { length: ID_LENGTH }),
	redirect_uri: varchar('redirect_uri', { length: ID_LENGTH }).notNull(),
	scopes: text('scopes').array().notNull(),
	user_id: varchar('user_id', { length: ID_LENGTH }).notNull()
});

export const oauthRefreshTokensTable = pgTable('auth_oauth_refresh_tokens', {
	claims_json: jsonb('claims_json').$type<Record<string, unknown>>(),
	client_id: varchar('client_id', { length: ID_LENGTH }).notNull(),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	dpop_jkt: varchar('dpop_jkt', { length: ID_LENGTH }),
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
	scopes: text('scopes').array().notNull(),
	token_hash: varchar('token_hash', { length: ID_LENGTH }).primaryKey(),
	user_id: varchar('user_id', { length: ID_LENGTH }).notNull()
});

type ClientRow = typeof oauthClientsTable.$inferSelect;
type CodeRow = typeof oauthCodesTable.$inferSelect;
type RefreshRow = typeof oauthRefreshTokensTable.$inferSelect;

const toClient = (row: ClientRow): OAuthClient => ({
	clientId: row.client_id,
	hashedSecret: row.hashed_secret ?? undefined,
	name: row.name,
	redirectUris: row.redirect_uris,
	scopes: row.scopes
});

const toCode = (row: CodeRow): AuthorizationCode => ({
	claims: row.claims_json ?? undefined,
	clientId: row.client_id,
	codeChallenge: row.code_challenge,
	codeHash: row.code_hash,
	createdAt: row.created_at_ms,
	dpopJkt: row.dpop_jkt ?? undefined,
	expiresAt: row.expires_at_ms,
	nonce: row.nonce ?? undefined,
	redirectUri: row.redirect_uri,
	scopes: row.scopes,
	userId: row.user_id
});

const toCodeValues = (
	code: AuthorizationCode
): typeof oauthCodesTable.$inferInsert => ({
	claims_json: code.claims ?? null,
	client_id: code.clientId,
	code_challenge: code.codeChallenge,
	code_hash: code.codeHash,
	created_at_ms: code.createdAt,
	dpop_jkt: code.dpopJkt ?? null,
	expires_at_ms: code.expiresAt,
	nonce: code.nonce ?? null,
	redirect_uri: code.redirectUri,
	scopes: code.scopes,
	user_id: code.userId
});

const toRefresh = (row: RefreshRow): OidcRefreshToken => ({
	claims: row.claims_json ?? undefined,
	clientId: row.client_id,
	createdAt: row.created_at_ms,
	dpopJkt: row.dpop_jkt ?? undefined,
	expiresAt: row.expires_at_ms,
	scopes: row.scopes,
	tokenHash: row.token_hash,
	userId: row.user_id
});

const toRefreshValues = (
	token: OidcRefreshToken
): typeof oauthRefreshTokensTable.$inferInsert => ({
	claims_json: token.claims ?? null,
	client_id: token.clientId,
	created_at_ms: token.createdAt,
	dpop_jkt: token.dpopJkt ?? null,
	expires_at_ms: token.expiresAt,
	scopes: token.scopes,
	token_hash: token.tokenHash,
	user_id: token.userId
});

export const createNeonAuthorizationCodeStore = (databaseUrl: string) =>
	createPostgresAuthorizationCodeStore(createNeonDatabase(databaseUrl));
export const createNeonOAuthClientStore = (databaseUrl: string) =>
	createPostgresOAuthClientStore(createNeonDatabase(databaseUrl));
export const createNeonOidcRefreshTokenStore = (databaseUrl: string) =>
	createPostgresOidcRefreshTokenStore(createNeonDatabase(databaseUrl));
export const createPostgresAuthorizationCodeStore = (
	db: AnyPgDatabase
): AuthorizationCodeStore => ({
	consumeCode: async (codeHash) => {
		const [row] = await db
			.delete(oauthCodesTable)
			.where(eq(oauthCodesTable.code_hash, codeHash))
			.returning();

		return row ? toCode(row) : undefined;
	},
	saveCode: async (code) => {
		await db.insert(oauthCodesTable).values(toCodeValues(code));
	}
});
export const createPostgresOAuthClientStore = (
	db: AnyPgDatabase
): OAuthClientStore => ({
	findClient: async (clientId) => {
		const [row] = await db
			.select()
			.from(oauthClientsTable)
			.where(eq(oauthClientsTable.client_id, clientId))
			.limit(1);

		return row ? toClient(row) : undefined;
	}
});
export const createPostgresOidcRefreshTokenStore = (
	db: AnyPgDatabase
): OidcRefreshTokenStore => ({
	consumeToken: async (tokenHash) => {
		const [row] = await db
			.delete(oauthRefreshTokensTable)
			.where(eq(oauthRefreshTokensTable.token_hash, tokenHash))
			.returning();

		return row ? toRefresh(row) : undefined;
	},
	deleteForUser: async (userId) => {
		await db
			.delete(oauthRefreshTokensTable)
			.where(eq(oauthRefreshTokensTable.user_id, userId));
	},
	saveToken: async (token) => {
		await db.insert(oauthRefreshTokensTable).values(toRefreshValues(token));
	}
});
