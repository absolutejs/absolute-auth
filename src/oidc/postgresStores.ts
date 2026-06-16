import { and, desc, eq, gt, lt } from 'drizzle-orm';
import {
	bigint,
	boolean,
	jsonb,
	pgTable,
	text,
	varchar
} from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	AuthorizationCode,
	AuthorizationCodeStore,
	BackchannelAuthRequest,
	BackchannelAuthStatus,
	BackchannelAuthStore,
	ClientAssertionJtiStore,
	ClientRegistrationToken,
	ClientRegistrationTokenStore,
	DeviceAuthorization,
	DeviceAuthorizationStatus,
	DeviceAuthorizationStore,
	InitialAccessTokenStore,
	LogoutDelivery,
	LogoutDeliveryStore,
	OAuthClient,
	OAuthClientStore,
	OidcRefreshToken,
	OidcRefreshTokenStore,
	PushedAuthorizationRequest,
	PushedAuthorizationRequestStore
} from './types';

const URL_LENGTH = 2048;
const DEFAULT_LIST_LIMIT = 100;

const ID_LENGTH = 255;

export const oauthBackchannelAuthRequestsTable = pgTable(
	'auth_oauth_backchannel_auth_requests',
	{
		auth_req_id: varchar('auth_req_id', { length: ID_LENGTH }).primaryKey(),
		binding_message: text('binding_message'),
		client_id: varchar('client_id', { length: ID_LENGTH }).notNull(),
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
		interval_seconds: bigint('interval_seconds', {
			mode: 'number'
		}).notNull(),
		last_polled_at_ms: bigint('last_polled_at_ms', { mode: 'number' }),
		scopes: text('scopes').array().notNull(),
		status: varchar('status', { length: 16 }).notNull(),
		user_sub: varchar('user_sub', { length: ID_LENGTH })
	}
);
export const oauthClientAssertionJtisTable = pgTable(
	'auth_oauth_client_assertion_jtis',
	{
		client_id: varchar('client_id', { length: ID_LENGTH }).notNull(),
		composite_key: varchar('composite_key', {
			length: ID_LENGTH
		}).primaryKey(),
		expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
		jti: varchar('jti', { length: ID_LENGTH }).notNull()
	}
);
export const oauthClientRegistrationTokensTable = pgTable(
	'auth_oauth_client_registration_tokens',
	{
		client_id: varchar('client_id', { length: ID_LENGTH }).notNull(),
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		token_hash: varchar('token_hash', { length: ID_LENGTH }).primaryKey()
	}
);
export const oauthClientsTable = pgTable('auth_oauth_clients', {
	backchannel_logout_uri: varchar('backchannel_logout_uri', {
		length: URL_LENGTH
	}),
	client_id: varchar('client_id', { length: ID_LENGTH }).primaryKey(),
	hashed_secret: varchar('hashed_secret', { length: ID_LENGTH }),
	jwks_json: jsonb('jwks_json').$type<JsonWebKey[]>(),
	jwks_uri: varchar('jwks_uri', { length: URL_LENGTH }),
	name: varchar('name', { length: ID_LENGTH }).notNull(),
	post_logout_redirect_uris: text('post_logout_redirect_uris').array(),
	redirect_uris: text('redirect_uris').array().notNull(),
	require_pushed_authorization_requests: boolean(
		'require_pushed_authorization_requests'
	),
	require_signed_request_object: boolean('require_signed_request_object'),
	scopes: text('scopes').array().notNull()
});
export const oauthCodesTable = pgTable('auth_oauth_codes', {
	acr: varchar('acr', { length: ID_LENGTH }),
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
		interval_seconds: bigint('interval_seconds', {
			mode: 'number'
		}).notNull(),
		scopes: text('scopes').array().notNull(),
		status: varchar('status', { length: 16 }).notNull(),
		user_code: varchar('user_code', { length: 16 }).notNull().unique(),
		user_sub: varchar('user_sub', { length: ID_LENGTH })
	}
);
export const oauthInitialAccessTokensTable = pgTable(
	'auth_oauth_initial_access_tokens',
	{
		token_hash: varchar('token_hash', { length: ID_LENGTH }).primaryKey()
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
export const oauthPushedAuthorizationRequestsTable = pgTable(
	'auth_oauth_pushed_authorization_requests',
	{
		client_id: varchar('client_id', { length: ID_LENGTH }).notNull(),
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
		params_json: jsonb('params_json')
			.$type<Record<string, string>>()
			.notNull(),
		request_uri_hash: varchar('request_uri_hash', {
			length: ID_LENGTH
		}).primaryKey()
	}
);
export const oauthRefreshTokensTable = pgTable('auth_oauth_refresh_tokens', {
	acr: varchar('acr', { length: ID_LENGTH }),
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
	jwks: row.jwks_json ?? undefined,
	jwksUri: row.jwks_uri ?? undefined,
	name: row.name,
	postLogoutRedirectUris: row.post_logout_redirect_uris ?? undefined,
	redirectUris: row.redirect_uris,
	requirePushedAuthorizationRequests:
		row.require_pushed_authorization_requests ?? undefined,
	requireSignedRequestObject: row.require_signed_request_object ?? undefined,
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
	acr: row.acr ?? undefined,
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
	acr: code.acr ?? null,
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
	acr: row.acr ?? undefined,
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
	acr: token.acr ?? null,
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
export const createNeonClientAssertionJtiStore = (databaseUrl: string) =>
	createPostgresClientAssertionJtiStore(createNeonDatabase(databaseUrl));
export const createNeonClientRegistrationTokenStore = (databaseUrl: string) =>
	createPostgresClientRegistrationTokenStore(createNeonDatabase(databaseUrl));
export const createNeonDeviceAuthorizationStore = (databaseUrl: string) =>
	createPostgresDeviceAuthorizationStore(createNeonDatabase(databaseUrl));
export const createNeonInitialAccessTokenStore = (databaseUrl: string) =>
	createPostgresInitialAccessTokenStore(createNeonDatabase(databaseUrl));
export const createNeonLogoutDeliveryStore = (databaseUrl: string) =>
	createPostgresLogoutDeliveryStore(createNeonDatabase(databaseUrl));
export const createNeonOAuthClientStore = (databaseUrl: string) =>
	createPostgresOAuthClientStore(createNeonDatabase(databaseUrl));
export const createNeonOidcRefreshTokenStore = (databaseUrl: string) =>
	createPostgresOidcRefreshTokenStore(createNeonDatabase(databaseUrl));
export const createNeonPushedAuthorizationRequestStore = (
	databaseUrl: string
) =>
	createPostgresPushedAuthorizationRequestStore(
		createNeonDatabase(databaseUrl)
	);
export const createPostgresAuthorizationCodeStore = <DB extends AnyPgDatabase>(
	db: DB
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
export const createPostgresClientAssertionJtiStore = <DB extends AnyPgDatabase>(
	db: DB
): ClientAssertionJtiStore => ({
	recordIfFresh: async (clientId, jti, expiresAt) => {
		// Lazy GC of expired entries on each call. Bounded by the assertion `exp` window
		// (~5 min), so this stays cheap even at high call volume.
		await db
			.delete(oauthClientAssertionJtisTable)
			.where(lt(oauthClientAssertionJtisTable.expires_at_ms, Date.now()));
		const compositeKey = `${clientId}|${jti}`;
		try {
			await db.insert(oauthClientAssertionJtisTable).values({
				client_id: clientId,
				composite_key: compositeKey,
				expires_at_ms: expiresAt,
				jti
			});

			return true;
		} catch {
			// PK collision = we've seen this jti for this client before = replay.
			return false;
		}
	}
});
export const createPostgresClientRegistrationTokenStore = <
	DB extends AnyPgDatabase
>(
	db: DB
): ClientRegistrationTokenStore => ({
	deleteByClientId: async (clientId) => {
		await db
			.delete(oauthClientRegistrationTokensTable)
			.where(eq(oauthClientRegistrationTokensTable.client_id, clientId));
	},
	findByTokenHash: async (tokenHash) => {
		const [row] = await db
			.select()
			.from(oauthClientRegistrationTokensTable)
			.where(eq(oauthClientRegistrationTokensTable.token_hash, tokenHash))
			.limit(1);
		if (!row) return undefined;
		const token: ClientRegistrationToken = {
			clientId: row.client_id,
			createdAt: row.created_at_ms,
			tokenHash: row.token_hash
		};

		return token;
	},
	saveToken: async (token) => {
		// One reg token per client — drop any prior token before saving.
		await db
			.delete(oauthClientRegistrationTokensTable)
			.where(
				eq(oauthClientRegistrationTokensTable.client_id, token.clientId)
			);
		await db.insert(oauthClientRegistrationTokensTable).values({
			client_id: token.clientId,
			created_at_ms: token.createdAt,
			token_hash: token.tokenHash
		});
	}
});
export const createPostgresDeviceAuthorizationStore = <
	DB extends AnyPgDatabase
>(
	db: DB
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
export const createPostgresInitialAccessTokenStore = <DB extends AnyPgDatabase>(
	db: DB
): InitialAccessTokenStore => ({
	consumeToken: async (tokenHash) => {
		const deleted = await db
			.delete(oauthInitialAccessTokensTable)
			.where(eq(oauthInitialAccessTokensTable.token_hash, tokenHash))
			.returning({
				token_hash: oauthInitialAccessTokensTable.token_hash
			});

		return deleted.length > 0;
	}
});
export const createPostgresLogoutDeliveryStore = <DB extends AnyPgDatabase>(
	db: DB
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
// Maps an OAuthClient domain object to the row shape (used by saveClient + updateClient).
const toClientValues = (
	client: OAuthClient
): typeof oauthClientsTable.$inferInsert => ({
	backchannel_logout_uri: client.backchannelLogoutUri ?? null,
	client_id: client.clientId,
	hashed_secret: client.hashedSecret ?? null,
	jwks_json: client.jwks ?? null,
	jwks_uri: client.jwksUri ?? null,
	name: client.name,
	post_logout_redirect_uris: client.postLogoutRedirectUris ?? null,
	redirect_uris: client.redirectUris,
	require_pushed_authorization_requests:
		client.requirePushedAuthorizationRequests ?? null,
	require_signed_request_object: client.requireSignedRequestObject ?? null,
	scopes: client.scopes
});

export const createPostgresOAuthClientStore = <DB extends AnyPgDatabase>(
	db: DB
): OAuthClientStore => ({
	deleteClient: async (clientId) => {
		await db
			.delete(oauthClientsTable)
			.where(eq(oauthClientsTable.client_id, clientId));
	},
	findClient: async (clientId) => {
		const [row] = await db
			.select()
			.from(oauthClientsTable)
			.where(eq(oauthClientsTable.client_id, clientId))
			.limit(1);

		return row ? toClient(row) : undefined;
	},
	saveClient: async (client) => {
		await db.insert(oauthClientsTable).values(toClientValues(client));
	},
	updateClient: async (clientId, client) => {
		await db
			.update(oauthClientsTable)
			.set(toClientValues(client))
			.where(eq(oauthClientsTable.client_id, clientId));
	}
});
export const createPostgresOidcRefreshTokenStore = <DB extends AnyPgDatabase>(
	db: DB
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
export const createPostgresPushedAuthorizationRequestStore = <
	DB extends AnyPgDatabase
>(
	db: DB
): PushedAuthorizationRequestStore => ({
	consumeRequest: async (requestUriHash) => {
		const [row] = await db
			.delete(oauthPushedAuthorizationRequestsTable)
			.where(
				eq(
					oauthPushedAuthorizationRequestsTable.request_uri_hash,
					requestUriHash
				)
			)
			.returning();
		if (!row) return undefined;
		// Lazy GC of expired rows from prior writes — keeps the table thin without a
		// dedicated cron. Same call returns undefined if THIS request was already expired.
		await db
			.delete(oauthPushedAuthorizationRequestsTable)
			.where(
				lt(
					oauthPushedAuthorizationRequestsTable.expires_at_ms,
					Date.now()
				)
			);
		if (row.expires_at_ms < Date.now()) return undefined;
		const request: PushedAuthorizationRequest = {
			clientId: row.client_id,
			createdAt: row.created_at_ms,
			expiresAt: row.expires_at_ms,
			params: row.params_json,
			requestUriHash: row.request_uri_hash
		};

		return request;
	},
	saveRequest: async (request) => {
		await db.insert(oauthPushedAuthorizationRequestsTable).values({
			client_id: request.clientId,
			created_at_ms: request.createdAt,
			expires_at_ms: request.expiresAt,
			params_json: request.params,
			request_uri_hash: request.requestUriHash
		});
	}
});

type BackchannelAuthRow = typeof oauthBackchannelAuthRequestsTable.$inferSelect;

const toBackchannelAuth = (
	row: BackchannelAuthRow
): BackchannelAuthRequest => ({
	authReqId: row.auth_req_id,
	bindingMessage: row.binding_message ?? undefined,
	clientId: row.client_id,
	createdAt: row.created_at_ms,
	expiresAt: row.expires_at_ms,
	intervalSeconds: row.interval_seconds,
	lastPolledAt: row.last_polled_at_ms ?? undefined,
	scopes: row.scopes,
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- deserialization boundary: status was persisted from BackchannelAuthStatus
	status: row.status as BackchannelAuthStatus,
	userSub: row.user_sub ?? undefined
});

export const createNeonBackchannelAuthStore = (databaseUrl: string) =>
	createPostgresBackchannelAuthStore(createNeonDatabase(databaseUrl));

export const createPostgresBackchannelAuthStore = <DB extends AnyPgDatabase>(
	db: DB
): BackchannelAuthStore => ({
	deleteByAuthReqId: async (authReqId) => {
		await db
			.delete(oauthBackchannelAuthRequestsTable)
			.where(
				eq(oauthBackchannelAuthRequestsTable.auth_req_id, authReqId)
			);
	},
	findByAuthReqId: async (authReqId) => {
		const [row] = await db
			.select()
			.from(oauthBackchannelAuthRequestsTable)
			.where(eq(oauthBackchannelAuthRequestsTable.auth_req_id, authReqId))
			.limit(1);

		return row ? toBackchannelAuth(row) : undefined;
	},
	recordPoll: async (authReqId, polledAt) => {
		await db
			.update(oauthBackchannelAuthRequestsTable)
			.set({ last_polled_at_ms: polledAt })
			.where(
				eq(oauthBackchannelAuthRequestsTable.auth_req_id, authReqId)
			);
	},
	saveBackchannelAuth: async (request) => {
		await db.insert(oauthBackchannelAuthRequestsTable).values({
			auth_req_id: request.authReqId,
			binding_message: request.bindingMessage ?? null,
			client_id: request.clientId,
			created_at_ms: request.createdAt,
			expires_at_ms: request.expiresAt,
			interval_seconds: request.intervalSeconds,
			last_polled_at_ms: request.lastPolledAt ?? null,
			scopes: request.scopes,
			status: request.status,
			user_sub: request.userSub ?? null
		});
	},
	updateStatus: async (authReqId, status, userSub) => {
		await db
			.update(oauthBackchannelAuthRequestsTable)
			.set({ status, user_sub: userSub ?? null })
			.where(
				eq(oauthBackchannelAuthRequestsTable.auth_req_id, authReqId)
			);
	}
});
