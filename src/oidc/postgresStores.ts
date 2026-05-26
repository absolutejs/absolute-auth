import { eq } from 'drizzle-orm';
import { bigint, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	AuthorizationCode,
	AuthorizationCodeStore,
	DeviceAuthorization,
	DeviceAuthorizationStatus,
	DeviceAuthorizationStore,
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

export const oauthDeviceAuthorizationsTable = pgTable(
	'auth_oauth_device_authorizations',
	{
		client_id: varchar('client_id', { length: ID_LENGTH }).notNull(),
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		device_code_hash: varchar('device_code_hash', {
			length: ID_LENGTH
		}).primaryKey(),
		expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
		interval_seconds: bigint('interval_seconds', { mode: 'number' }).notNull(),
		scopes: text('scopes').array().notNull(),
		status: varchar('status', { length: 16 }).notNull(),
		user_code: varchar('user_code', { length: 16 }).notNull().unique(),
		user_sub: varchar('user_sub', { length: ID_LENGTH })
	}
);

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
type DeviceAuthRow = typeof oauthDeviceAuthorizationsTable.$inferSelect;
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

const toDeviceAuth = (row: DeviceAuthRow): DeviceAuthorization => ({
	clientId: row.client_id,
	createdAt: row.created_at_ms,
	deviceCodeHash: row.device_code_hash,
	expiresAt: row.expires_at_ms,
	intervalSeconds: row.interval_seconds,
	scopes: row.scopes,
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- deserialization boundary: status was persisted from DeviceAuthorizationStatus
	status: row.status as DeviceAuthorizationStatus,
	userCode: row.user_code,
	userSub: row.user_sub ?? undefined
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
export const createNeonDeviceAuthorizationStore = (databaseUrl: string) =>
	createPostgresDeviceAuthorizationStore(createNeonDatabase(databaseUrl));
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
export const createPostgresDeviceAuthorizationStore = (
	db: AnyPgDatabase
): DeviceAuthorizationStore => ({
	deleteByDeviceCodeHash: async (deviceCodeHash) => {
		await db
			.delete(oauthDeviceAuthorizationsTable)
			.where(
				eq(
					oauthDeviceAuthorizationsTable.device_code_hash,
					deviceCodeHash
				)
			);
	},
	findByDeviceCodeHash: async (deviceCodeHash) => {
		const [row] = await db
			.select()
			.from(oauthDeviceAuthorizationsTable)
			.where(
				eq(
					oauthDeviceAuthorizationsTable.device_code_hash,
					deviceCodeHash
				)
			)
			.limit(1);

		return row ? toDeviceAuth(row) : undefined;
	},
	findByUserCode: async (userCode) => {
		const [row] = await db
			.select()
			.from(oauthDeviceAuthorizationsTable)
			.where(eq(oauthDeviceAuthorizationsTable.user_code, userCode))
			.limit(1);

		return row ? toDeviceAuth(row) : undefined;
	},
	saveDeviceAuthorization: async (deviceAuthorization) => {
		await db.insert(oauthDeviceAuthorizationsTable).values({
			client_id: deviceAuthorization.clientId,
			created_at_ms: deviceAuthorization.createdAt,
			device_code_hash: deviceAuthorization.deviceCodeHash,
			expires_at_ms: deviceAuthorization.expiresAt,
			interval_seconds: deviceAuthorization.intervalSeconds,
			scopes: deviceAuthorization.scopes,
			status: deviceAuthorization.status,
			user_code: deviceAuthorization.userCode,
			user_sub: deviceAuthorization.userSub ?? null
		});
	},
	updateStatus: async (deviceCodeHash, status, userSub) => {
		await db
			.update(oauthDeviceAuthorizationsTable)
			.set({ status, user_sub: userSub ?? null })
			.where(
				eq(
					oauthDeviceAuthorizationsTable.device_code_hash,
					deviceCodeHash
				)
			);
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
	getToken: async (tokenHash) => {
		const [row] = await db
			.select()
			.from(oauthRefreshTokensTable)
			.where(eq(oauthRefreshTokensTable.token_hash, tokenHash))
			.limit(1);

		return row ? toRefresh(row) : undefined;
	},
	saveToken: async (token) => {
		await db.insert(oauthRefreshTokensTable).values(toRefreshValues(token));
	}
});
