// Postgres flavors of every VC store: credential offer (VCI), credential nonce (VCI),
// presentation request (OID4VP). Same Drizzle pattern as the rest of the package — the
// schema goes into the migrations block automatically via `getTableConfig`.
//
// All tables prefixed `auth_vc_*` so they sit alongside `auth_oauth_*` cleanly.

import { eq } from 'drizzle-orm';
import { bigint, boolean, jsonb, pgTable, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	CredentialNonceRecord,
	CredentialNonceStore,
	CredentialOffer,
	CredentialOfferStore
} from '../oidc/vci';
import type {
	PresentationRequest,
	PresentationRequestStore
} from './openid4vp';

const ID_LENGTH = 255;

export const vcCredentialNoncesTable = pgTable('auth_vc_credential_nonces', {
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
	nonce_hash: varchar('nonce_hash', { length: ID_LENGTH }).primaryKey()
});
export const vcCredentialOffersTable = pgTable('auth_vc_credential_offers', {
	client_id: varchar('client_id', { length: ID_LENGTH }).notNull(),
	configuration_id: varchar('configuration_id', {
		length: ID_LENGTH
	}).notNull(),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
	pre_authorized_code_hash: varchar('pre_authorized_code_hash', {
		length: ID_LENGTH
	}).primaryKey(),
	redeemed: boolean('redeemed').notNull(),
	user_id: varchar('user_id', { length: ID_LENGTH }).notNull()
});
export const vcPresentationRequestsTable = pgTable(
	'auth_vc_presentation_requests',
	{
		client_id: varchar('client_id', { length: ID_LENGTH }).notNull(),
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		expected_issuer_jwk_json: jsonb('expected_issuer_jwk_json')
			.$type<JsonWebKey>()
			.notNull(),
		expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
		nonce: varchar('nonce', { length: ID_LENGTH }).notNull(),
		request_id: varchar('request_id', { length: ID_LENGTH }).primaryKey(),
		requested_claims: jsonb('requested_claims').$type<string[]>().notNull(),
		response_uri: varchar('response_uri', { length: ID_LENGTH }).notNull(),
		state: varchar('state', { length: ID_LENGTH })
	}
);

const toOffer = (
	row: typeof vcCredentialOffersTable.$inferSelect
): CredentialOffer => ({
	clientId: row.client_id,
	configurationId: row.configuration_id,
	createdAt: row.created_at_ms,
	expiresAt: row.expires_at_ms,
	preAuthorizedCodeHash: row.pre_authorized_code_hash,
	redeemed: row.redeemed,
	userId: row.user_id
});

const toOfferValues = (
	offer: CredentialOffer
): typeof vcCredentialOffersTable.$inferInsert => ({
	client_id: offer.clientId,
	configuration_id: offer.configurationId,
	created_at_ms: offer.createdAt,
	expires_at_ms: offer.expiresAt,
	pre_authorized_code_hash: offer.preAuthorizedCodeHash,
	redeemed: offer.redeemed,
	user_id: offer.userId
});

const toPresentationRequest = (
	row: typeof vcPresentationRequestsTable.$inferSelect
): PresentationRequest => ({
	clientId: row.client_id,
	createdAt: row.created_at_ms,
	expectedIssuerPublicJwk: row.expected_issuer_jwk_json,
	expiresAt: row.expires_at_ms,
	nonce: row.nonce,
	requestedClaims: row.requested_claims,
	requestId: row.request_id,
	responseUri: row.response_uri,
	state: row.state ?? undefined
});

const toPresentationRequestValues = (
	request: PresentationRequest
): typeof vcPresentationRequestsTable.$inferInsert => ({
	client_id: request.clientId,
	created_at_ms: request.createdAt,
	expected_issuer_jwk_json: request.expectedIssuerPublicJwk,
	expires_at_ms: request.expiresAt,
	nonce: request.nonce,
	request_id: request.requestId,
	requested_claims: request.requestedClaims,
	response_uri: request.responseUri,
	state: request.state ?? null
});

export const createNeonCredentialNonceStore = (databaseUrl: string) =>
	createPostgresCredentialNonceStore(createNeonDatabase(databaseUrl));
export const createNeonCredentialOfferStore = (databaseUrl: string) =>
	createPostgresCredentialOfferStore(createNeonDatabase(databaseUrl));
export const createNeonPresentationRequestStore = (databaseUrl: string) =>
	createPostgresPresentationRequestStore(createNeonDatabase(databaseUrl));
export const createPostgresCredentialNonceStore = <DB extends AnyPgDatabase>(
	database: DB
): CredentialNonceStore => ({
	consumeNonce: async (nonceHash) => {
		const rows = await database
			.select()
			.from(vcCredentialNoncesTable)
			.where(eq(vcCredentialNoncesTable.nonce_hash, nonceHash))
			.limit(1);
		const [row] = rows;
		if (row === undefined) return undefined;
		await database
			.delete(vcCredentialNoncesTable)
			.where(eq(vcCredentialNoncesTable.nonce_hash, nonceHash));
		const record: CredentialNonceRecord = {
			expiresAt: row.expires_at_ms,
			nonceHash: row.nonce_hash
		};

		return record;
	},
	saveNonce: async (record) => {
		await database.insert(vcCredentialNoncesTable).values({
			expires_at_ms: record.expiresAt,
			nonce_hash: record.nonceHash
		});
	}
});
export const createPostgresCredentialOfferStore = <DB extends AnyPgDatabase>(
	database: DB
): CredentialOfferStore => ({
	consumeOffer: async (preAuthorizedCodeHash) => {
		const rows = await database
			.select()
			.from(vcCredentialOffersTable)
			.where(
				eq(
					vcCredentialOffersTable.pre_authorized_code_hash,
					preAuthorizedCodeHash
				)
			)
			.limit(1);
		const [row] = rows;
		if (row === undefined) return undefined;
		await database
			.update(vcCredentialOffersTable)
			.set({ redeemed: true })
			.where(
				eq(
					vcCredentialOffersTable.pre_authorized_code_hash,
					preAuthorizedCodeHash
				)
			);

		return toOffer(row);
	},
	saveOffer: async (offer) => {
		await database
			.insert(vcCredentialOffersTable)
			.values(toOfferValues(offer));
	}
});
export const createPostgresPresentationRequestStore = <
	DB extends AnyPgDatabase
>(
	database: DB
): PresentationRequestStore => ({
	consumeRequest: async (requestId) => {
		const rows = await database
			.select()
			.from(vcPresentationRequestsTable)
			.where(eq(vcPresentationRequestsTable.request_id, requestId))
			.limit(1);
		const [row] = rows;
		if (row === undefined) return undefined;
		await database
			.delete(vcPresentationRequestsTable)
			.where(eq(vcPresentationRequestsTable.request_id, requestId));

		return toPresentationRequest(row);
	},
	getRequest: async (requestId) => {
		const rows = await database
			.select()
			.from(vcPresentationRequestsTable)
			.where(eq(vcPresentationRequestsTable.request_id, requestId))
			.limit(1);
		const [row] = rows;

		return row === undefined ? undefined : toPresentationRequest(row);
	},
	saveRequest: async (request) => {
		await database
			.insert(vcPresentationRequestsTable)
			.values(toPresentationRequestValues(request));
	}
});
