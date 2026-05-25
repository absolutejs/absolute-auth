import { beforeEach, describe, expect, test } from 'bun:test';
import {
	createApiClient,
	createApiKey,
	exchangeClientCredentials,
	hasScopes,
	resolveApiPrincipal,
	verifyAccessToken,
	verifyApiKey
} from '../src/apikeys/config';
import {
	createInMemoryAccessTokenStore,
	createInMemoryApiClientStore,
	createInMemoryApiKeyStore
} from '../src/apikeys/inMemoryStores';
import { auth } from '../src/index';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const ONE_HOUR_MS = 60 * 60 * 1000;

describe('static API keys', () => {
	let store = createInMemoryApiKeyStore();

	beforeEach(() => {
		store = createInMemoryApiKeyStore();
	});

	test('createApiKey returns a sk_ key shown once and stores only the hash', async () => {
		const { key, record } = await createApiKey(store, {
			name: 'CI',
			scopes: ['videos:read']
		});

		expect(key.startsWith('sk_')).toBe(true);
		expect(record.hashedKey).not.toBe(key);
		expect(record.prefix).toBe(key.slice(0, record.prefix.length));
		expect(record.scopes).toEqual(['videos:read']);
	});

	test('verifyApiKey resolves a valid key and touches lastUsedAt', async () => {
		const { key, record } = await createApiKey(store, { name: 'CI' });

		const resolved = await verifyApiKey(store, key);
		expect(resolved?.keyId).toBe(record.keyId);

		const [stored] = await store.listKeys();
		expect(stored?.lastUsedAt).toBeDefined();
	});

	test('verifyApiKey rejects unknown and expired keys', async () => {
		const now = Date.now();
		const { key } = await createApiKey(store, {
			expiresAt: now + ONE_HOUR_MS,
			name: 'CI'
		});

		expect(await verifyApiKey(store, 'sk_nope')).toBeUndefined();
		expect(
			await verifyApiKey(store, key, now + ONE_HOUR_MS + 1)
		).toBeUndefined();
		expect(await verifyApiKey(store, key, now)).toBeDefined();
	});

	test('hasScopes enforces AND semantics', async () => {
		const { key } = await createApiKey(store, {
			name: 'CI',
			scopes: ['videos:read', 'athletes:read']
		});
		const principal = await resolveApiPrincipal({
			apiKey: key,
			apiKeyStore: store
		});

		expect(hasScopes(principal, ['videos:read'])).toBe(true);
		expect(hasScopes(principal, ['videos:read', 'athletes:read'])).toBe(
			true
		);
		expect(hasScopes(principal, ['videos:write'])).toBe(false);
		expect(hasScopes(undefined, [])).toBe(false);
	});

	test('resolveApiPrincipal reads the Authorization bearer header', async () => {
		const { key } = await createApiKey(store, {
			name: 'CI',
			scopes: ['videos:read']
		});

		const principal = await resolveApiPrincipal({
			apiKeyStore: store,
			authorization: `Bearer ${key}`
		});
		expect(principal?.kind).toBe('api_key');
		expect(principal?.scopes).toEqual(['videos:read']);
	});
});

describe('client_credentials grant', () => {
	let clientStore = createInMemoryApiClientStore();
	let tokenStore = createInMemoryAccessTokenStore();

	beforeEach(() => {
		clientStore = createInMemoryApiClientStore();
		tokenStore = createInMemoryAccessTokenStore();
	});

	test('createApiClient returns a public id and a one-time secret', async () => {
		const { clientId, clientSecret, record } = await createApiClient(
			clientStore,
			{ name: 'partner', scopes: ['videos:read'] }
		);

		expect(clientId.startsWith('cid_')).toBe(true);
		expect(clientSecret.startsWith('cs_')).toBe(true);
		expect(record.hashedSecret).not.toBe(clientSecret);
	});

	test('exchangeClientCredentials mints an access token for granted scopes', async () => {
		const { clientId, clientSecret } = await createApiClient(clientStore, {
			name: 'partner',
			scopes: ['videos:read', 'athletes:read']
		});

		const result = await exchangeClientCredentials({
			accessTokenStore: tokenStore,
			apiClientStore: clientStore,
			clientId,
			clientSecret,
			requestedScopes: ['videos:read']
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.accessToken.startsWith('at_')).toBe(true);
			expect(result.scopes).toEqual(['videos:read']);
			const verified = await verifyAccessToken(
				tokenStore,
				result.accessToken
			);
			expect(verified?.clientId).toBe(clientId);
		}
	});

	test('exchangeClientCredentials rejects a bad secret and out-of-grant scopes', async () => {
		const { clientId, clientSecret } = await createApiClient(clientStore, {
			name: 'partner',
			scopes: ['videos:read']
		});

		const badSecret = await exchangeClientCredentials({
			accessTokenStore: tokenStore,
			apiClientStore: clientStore,
			clientId,
			clientSecret: 'cs_wrong'
		});
		expect(badSecret).toEqual({ error: 'invalid_client', ok: false });

		const badScope = await exchangeClientCredentials({
			accessTokenStore: tokenStore,
			apiClientStore: clientStore,
			clientId,
			clientSecret,
			requestedScopes: ['videos:write']
		});
		expect(badScope).toEqual({ error: 'invalid_scope', ok: false });
	});

	test('verifyAccessToken rejects expired tokens', async () => {
		const { clientId, clientSecret } = await createApiClient(clientStore, {
			name: 'partner',
			scopes: ['videos:read']
		});
		const now = Date.now();
		const result = await exchangeClientCredentials({
			accessTokenStore: tokenStore,
			apiClientStore: clientStore,
			clientId,
			clientSecret,
			now,
			ttlMs: ONE_HOUR_MS
		});

		if (result.ok) {
			expect(
				await verifyAccessToken(
					tokenStore,
					result.accessToken,
					now + ONE_HOUR_MS + 1
				)
			).toBeUndefined();
		}
	});
});

describe('token endpoint', () => {
	test('issues a token over the wire and rejects bad input', async () => {
		const clientStore = createInMemoryApiClientStore();
		const tokenStore = createInMemoryAccessTokenStore();
		const app = await auth({
			apikeys: {
				accessTokenStore: tokenStore,
				apiClientStore: clientStore
			},
			providersConfiguration: {}
		});
		const { clientId, clientSecret } = await createApiClient(clientStore, {
			name: 'partner',
			scopes: ['videos:read']
		});

		const ok = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					client_id: clientId,
					client_secret: clientSecret,
					grant_type: 'client_credentials',
					scope: 'videos:read'
				}),
				method: 'POST'
			})
		);
		expect(ok.status).toBe(HTTP_OK);
		const okBody = await ok.json();
		expect(okBody.token_type).toBe('Bearer');
		expect(okBody.scope).toBe('videos:read');
		expect(typeof okBody.access_token).toBe('string');

		const wrongGrant = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({ grant_type: 'password' }),
				method: 'POST'
			})
		);
		expect(wrongGrant.status).toBe(HTTP_BAD_REQUEST);

		const badClient = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					client_id: clientId,
					client_secret: 'cs_wrong',
					grant_type: 'client_credentials'
				}),
				method: 'POST'
			})
		);
		expect(badClient.status).toBe(HTTP_UNAUTHORIZED);
	});

	test('accepts HTTP Basic client authentication', async () => {
		const clientStore = createInMemoryApiClientStore();
		const tokenStore = createInMemoryAccessTokenStore();
		const app = await auth({
			apikeys: {
				accessTokenStore: tokenStore,
				apiClientStore: clientStore
			},
			providersConfiguration: {}
		});
		const { clientId, clientSecret } = await createApiClient(clientStore, {
			name: 'partner',
			scopes: ['videos:read']
		});

		const basic = Buffer.from(`${clientId}:${clientSecret}`).toString(
			'base64'
		);
		const response = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					grant_type: 'client_credentials'
				}),
				headers: { authorization: `Basic ${basic}` },
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_OK);
	});

	test('mounts nothing when stores are absent', async () => {
		const app = await auth({ providersConfiguration: {} });
		const response = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					grant_type: 'client_credentials'
				}),
				method: 'POST'
			})
		);
		expect(response.status).not.toBe(HTTP_OK);
	});
});
