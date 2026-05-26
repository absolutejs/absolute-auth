import { and, desc, eq, gt } from 'drizzle-orm';
import { bigint, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	AuthorizationCode,
	AuthorizationCodeStore,
	DeviceAuthorization,
	DeviceAuthorizationStatus,
	DeviceAuthorizationStore,
	LogoutDelivery,
	LogoutDeliveryStore,
	OAuthClient,
	OAuthClientStore,
	OidcRefreshToken,
	OidcRefreshTokenStore
} from './types';

const URL_LENGTH = 2048;
const DEFAULT_LIST_LIMIT = 100;

const ID_LENGTH = 255;

export const oauthClientsTable = pgTable('auth_oauth_clients', {
	backchannel_logout_uri: varchar('backchannel_logout_uri', {
		length: URL_LENGTH
	}),
	client_id: varchar('client_id', { length: ID_LENGTH }).primaryKey(),
	hashed_secret: varchar('hashed_secret', { length: ID_LENGTH }),
	name: varchar('name', { length: ID_LENGTH }).notNull(),
	post_logout_redirect_uris: text('post_logout_redirect_uris').array(),
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

export const oauthLogoutDeliveriesTable = pgTable(
	'auth_oauth_logout_deliveries',
	{
		attempts: bigint('attempts', { mode: 'number' }).notNull(),
		client_id: varchar('client_id', { length: ID_LENGTH }).notNull(),
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		endpoint_url: varchar('endpoint_url', { length: URL_LENGTH }).notNull(),
		id: varchar('id', { length: ID_LENGTH }).primaryKey(),
		last_error: text('last_error'),
		last_status: bigint('last_status', { mode: 'number' }),
		logout_token: text('logout_token').notNull(),
		user_id: varchar('user_id', { length: ID_LENGTH }).notNull()
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
type LogoutDeliveryRow = typeof oauthLogoutDeliveriesTable.$inferSelect;
type RefreshRow = typeof oauthRefreshTokensTable.$inferSelect;

const toClient = (row: ClientRow): OAuthClient => ({
	backchannelLogoutUri: row.backchannel_logout_uri ?? undefined,
	clientId: row.client_id,
	hashedSecret: row.hashed_secret ?? undefined,
	name: row.name,
	postLogoutRedirectUris: row.post_logout_redirect_uris ?? undefined,
	redirectUris: row.redirect_uris,
	scopes: row.scopes
});

const toLogoutDelivery = (row: LogoutDeliveryRow): LogoutDelivery => ({
	attempts: row.attempts,
	clientId: row.client_id,
	createdAt: row.created_at_ms,
	endpointUrl: row.endpoint_url,
	id: row.id,
	lastError: row.last_error ?? undefined,
	lastStatus: row.last_status ?? undefined,
	logoutToken: row.logout_token,
	userId: row.user_id
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
export const createNeonLogoutDeliveryStore = (databaseUrl: string) =>
	createPostgresLogoutDeliveryStore(createNeonDatabase(databaseUrl));
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
export const createPostgresLogoutDeliveryStore = (
	db: AnyPgDatabase
): LogoutDeliveryStore => ({
	listFailed: async (limit = DEFAULT_LIST_LIMIT) => {
		const rows = await db
			.select()
			.from(oauthLogoutDeliveriesTable)
			.orderBy(desc(oauthLogoutDeliveriesTable.created_at_ms))
			.limit(limit);

		return rows.map(toLogoutDelivery);
	},
	recordFailure: async (delivery) => {
		await db.insert(oauthLogoutDeliveriesTable).values({
			attempts: delivery.attempts,
			client_id: delivery.clientId,
			created_at_ms: delivery.createdAt,
			endpoint_url: delivery.endpointUrl,
			id: delivery.id,
			last_error: delivery.lastError ?? null,
			last_status: delivery.lastStatus ?? null,
			logout_token: delivery.logoutToken,
			user_id: delivery.userId
		});
	},
	removeFailure: async (deliveryId) => {
		await db
			.delete(oauthLogoutDeliveriesTable)
			.where(eq(oauthLogoutDeliveriesTable.id, deliveryId));
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
	listClientIdsForUser: async (userId) => {
		const rows = await db
			.selectDistinct({ client_id: oauthRefreshTokensTable.client_id })
			.from(oauthRefreshTokensTable)
			.where(
				and(
					eq(oauthRefreshTokensTable.user_id, userId),
					gt(oauthRefreshTokensTable.expires_at_ms, Date.now())
				)
			);

		return rows.map((row) => row.client_id);
	},
	saveToken: async (token) => {
		await db.insert(oauthRefreshTokensTable).values(toRefreshValues(token));
	}
});
