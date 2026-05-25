import {
	MILLISECONDS_IN_A_SECOND,
	MILLISECONDS_IN_AN_HOUR
} from '../constants';
import { constantTimeEqual, generateSecureToken, hashToken } from '../crypto';
import type { RouteString } from '../types';
import type {
	AccessTokenStore,
	ApiClient,
	ApiClientStore,
	ApiKey,
	ApiKeyStore,
	ApiPrincipal
} from './types';

export const DEFAULT_TOKEN_ROUTE: RouteString = '/oauth2/token';

const ACCESS_TOKEN_PREFIX = 'at_';
const API_KEY_PREFIX = 'sk_';
const BEARER_PREFIX = 'Bearer ';
const CLIENT_SECRET_PREFIX = 'cs_';
const PREFIX_DISPLAY_LENGTH = 11;
const TOKEN_BYTES = 32;

const DEFAULT_ACCESS_TOKEN_TTL_MS = MILLISECONDS_IN_AN_HOUR;

// Machine-to-machine authentication: long-lived static API keys (`sk_…`) and the
// OAuth2 client_credentials grant (short-lived `at_…` access tokens). The package
// owns key/secret generation, hashing, scope checks, and the token endpoint; the
// consumer owns the management UX through the exported helpers, exactly like the
// SCIM-token surface.
export type ApiKeysConfig = {
	/** Where minted access tokens live — required (with `apiClientStore`) for the
	 *  client_credentials grant to be mounted. */
	accessTokenStore?: AccessTokenStore;
	/** Lifetime of a minted access token (defaults to one hour). */
	accessTokenTtlMs?: number;
	/** Registered M2M clients — required (with `accessTokenStore`) for the
	 *  client_credentials grant. */
	apiClientStore?: ApiClientStore;
	/** Static API keys. Used by the exported `verifyApiKey` / `resolveApiPrincipal`
	 *  helpers; the consumer wires its own management + guard routes. */
	apiKeyStore?: ApiKeyStore;
	/** Path of the client_credentials token endpoint (defaults to `/oauth2/token`). */
	tokenRoute?: RouteString;
};

// The result of an attempted client_credentials exchange — either a minted
// access token or a typed OAuth2 error (RFC 6749 §5.2).
export type ClientCredentialsResult =
	| { error: 'invalid_client' | 'invalid_scope'; ok: false }
	| { accessToken: string; expiresIn: number; ok: true; scopes: string[] };

const generateToken = (prefix: string) =>
	`${prefix}${generateSecureToken(TOKEN_BYTES)}`;

const grantedScopes = (clientScopes: string[], requested?: string[]) =>
	requested === undefined || requested.length === 0
		? clientScopes
		: requested.filter((scope) => clientScopes.includes(scope));

const readBearerToken = (authorization: string | undefined) => {
	if (
		authorization === undefined ||
		!authorization.startsWith(BEARER_PREFIX)
	) {
		return undefined;
	}
	const token = authorization.slice(BEARER_PREFIX.length).trim();

	return token.length === 0 ? undefined : token;
};

// Register a client_credentials client. The clientId is public; the secret
// (`cs_…`) is returned once and stored only as a hash.
export const createApiClient = async (
	apiClientStore: ApiClientStore,
	options: { name: string; ownerId?: string; scopes?: string[] }
) => {
	const clientId = `cid_${crypto.randomUUID()}`;
	const clientSecret = generateToken(CLIENT_SECRET_PREFIX);
	const record: ApiClient = {
		clientId,
		createdAt: Date.now(),
		hashedSecret: await hashToken(clientSecret),
		name: options.name,
		ownerId: options.ownerId,
		scopes: options.scopes ?? []
	};
	await apiClientStore.saveClient(record);

	return { clientId, clientSecret, record };
};

// Mint a static API key. The plaintext (`sk_…`) is returned once; only its hash
// is persisted.
export const createApiKey = async (
	apiKeyStore: ApiKeyStore,
	options: {
		expiresAt?: number;
		name: string;
		ownerId?: string;
		scopes?: string[];
	}
) => {
	const key = generateToken(API_KEY_PREFIX);
	const record: ApiKey = {
		createdAt: Date.now(),
		expiresAt: options.expiresAt,
		hashedKey: await hashToken(key),
		keyId: crypto.randomUUID(),
		name: options.name,
		ownerId: options.ownerId,
		prefix: key.slice(0, PREFIX_DISPLAY_LENGTH),
		scopes: options.scopes ?? []
	};
	await apiKeyStore.saveKey(record);

	return { key, record };
};

// Validate client_id + client_secret and mint a short-lived opaque access token
// for the granted scopes (requested ∩ client.scopes, or all of the client's
// scopes when none are requested).
export const exchangeClientCredentials = async ({
	accessTokenStore,
	apiClientStore,
	clientId,
	clientSecret,
	now = Date.now(),
	requestedScopes,
	ttlMs = DEFAULT_ACCESS_TOKEN_TTL_MS
}: {
	accessTokenStore: AccessTokenStore;
	apiClientStore: ApiClientStore;
	clientId: string;
	clientSecret: string;
	now?: number;
	requestedScopes?: string[];
	ttlMs?: number;
}): Promise<ClientCredentialsResult> => {
	const client = await apiClientStore.findClient(clientId);
	if (
		client === undefined ||
		!(await constantTimeEqual(
			await hashToken(clientSecret),
			client.hashedSecret
		))
	) {
		return { error: 'invalid_client', ok: false };
	}

	if (
		requestedScopes?.some((scope) => !client.scopes.includes(scope)) ===
		true
	) {
		return { error: 'invalid_scope', ok: false };
	}

	const accessToken = generateToken(ACCESS_TOKEN_PREFIX);
	const scopes = grantedScopes(client.scopes, requestedScopes);
	await accessTokenStore.saveToken({
		clientId: client.clientId,
		createdAt: now,
		expiresAt: now + ttlMs,
		hashedToken: await hashToken(accessToken),
		ownerId: client.ownerId,
		scopes,
		tokenId: crypto.randomUUID()
	});

	return {
		accessToken,
		expiresIn: Math.floor(ttlMs / MILLISECONDS_IN_A_SECOND),
		ok: true,
		scopes
	};
};

// Whether a principal holds every required scope (AND semantics). An empty
// `required` always passes.
export const hasScopes = (
	principal: ApiPrincipal | undefined,
	required: string[]
) =>
	principal !== undefined &&
	required.every((scope) => principal.scopes.includes(scope));

// Resolve a request's machine credential — `Authorization: Bearer …` or the
// `X-API-Key` header — to an `ApiPrincipal`, routing by token prefix to the
// configured stores. undefined when the credential is missing, unknown, or
// expired.
export const resolveApiPrincipal = async ({
	accessTokenStore,
	apiKey,
	apiKeyStore,
	authorization,
	now = Date.now()
}: {
	accessTokenStore?: AccessTokenStore;
	apiKey?: string;
	apiKeyStore?: ApiKeyStore;
	authorization?: string;
	now?: number;
}) => {
	const presented = readBearerToken(authorization) ?? apiKey;
	if (presented === undefined || presented.length === 0) return undefined;

	if (
		accessTokenStore !== undefined &&
		presented.startsWith(ACCESS_TOKEN_PREFIX)
	) {
		const token = await verifyAccessToken(accessTokenStore, presented, now);
		if (token === undefined) return undefined;
		const principal: ApiPrincipal = {
			id: token.clientId,
			kind: 'access_token',
			ownerId: token.ownerId,
			scopes: token.scopes
		};

		return principal;
	}

	if (apiKeyStore !== undefined && presented.startsWith(API_KEY_PREFIX)) {
		const key = await verifyApiKey(apiKeyStore, presented, now);
		if (key === undefined) return undefined;
		const principal: ApiPrincipal = {
			id: key.keyId,
			kind: 'api_key',
			ownerId: key.ownerId,
			scopes: key.scopes
		};

		return principal;
	}

	return undefined;
};

// Resolve a presented access token to its record (or undefined when unknown or
// expired).
export const verifyAccessToken = async (
	accessTokenStore: AccessTokenStore,
	presented: string,
	now = Date.now()
) => {
	const record = await accessTokenStore.findByHashedToken(
		await hashToken(presented)
	);
	if (record === undefined || record.expiresAt <= now) return undefined;

	return record;
};

// Resolve a presented static key to its record (or undefined when unknown or
// expired). Touches `lastUsedAt` on success.
export const verifyApiKey = async (
	apiKeyStore: ApiKeyStore,
	presented: string,
	now = Date.now()
) => {
	const record = await apiKeyStore.findByHashedKey(
		await hashToken(presented)
	);
	if (record === undefined) return undefined;
	if (record.expiresAt !== undefined && record.expiresAt <= now) {
		return undefined;
	}
	await apiKeyStore.touchKey(record.keyId, now);

	return record;
};
