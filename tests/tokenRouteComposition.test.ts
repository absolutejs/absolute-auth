import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiClient, verifyAccessToken } from '../src/apikeys/config';
import {
	createInMemoryAccessTokenStore,
	createInMemoryApiClientStore
} from '../src/apikeys/inMemoryStores';
import { apiKeysRoutes } from '../src/apikeys/routes';
import { hashToken } from '../src/crypto';
import { auth } from '../src/index';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { generateSigningKey, verifyJwt } from '../src/oidc/keys';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const ISSUER = 'https://onspark.example';
const RESOURCE = `${ISSUER}/mcp`;
const REDIRECT_URI = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'pkce-verifier-0123456789-abcdefghij-0123456789';
const HTTP_OK = 200;
const HTTP_REDIRECT = 302;
const HOUR_MS = 3_600_000;
const post = (path: string, body: Record<string, string>) =>
	new Request(`http://localhost${path}`, {
		body: new URLSearchParams(body),
		method: 'POST'
	});

const configuration = async () => {
	const authSessionStore = createInMemoryAuthSessionStore<{ sub: string }>();
	await authSessionStore.setSession(SESSION_ID, {
		authenticatedAt: Date.now(),
		expiresAt: Date.now() + HOUR_MS,
		user: { sub: 'ray' }
	});

	return {
		apikeys: {
			accessTokenStore: createInMemoryAccessTokenStore(),
			apiClientStore: createInMemoryApiClientStore()
		},
		authSessionStore,
		oidc: {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([
				{
					clientId: 'claude',
					name: 'Claude',
					redirectUris: [REDIRECT_URI],
					scopes: ['openid', 'mcp']
				}
			]),
			issuer: ISSUER,
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			scopes: ['openid', 'mcp'],
			signingKey: await generateSigningKey(),
			getUserId: (user: { sub: string }) => user.sub
		},
		providersConfiguration: {}
	};
};

describe('OAuth and API credential token route composition', () => {
	for (const mounting of ['combined', 'api-first', 'api-last']) {
		test(`${mounting}: authorization code, refresh and machine credentials coexist`, async () => {
			const config = await configuration();
			const { apikeys, ...oidcConfig } = config;
			const oauth = await auth(oidcConfig);
			let application = new Elysia()
				.use(oauth)
				.use(apiKeysRoutes(apikeys));
			if (mounting === 'combined')
				application = new Elysia().use(await auth(config));
			if (mounting === 'api-first')
				application = new Elysia()
					.use(apiKeysRoutes(apikeys))
					.use(oauth);
			const params = new URLSearchParams({
				client_id: 'claude',
				code_challenge: await hashToken(VERIFIER),
				code_challenge_method: 'S256',
				redirect_uri: REDIRECT_URI,
				resource: RESOURCE,
				response_type: 'code',
				scope: 'openid mcp',
				state: 'test-state'
			});
			const authorized = await application.handle(
				new Request(`http://localhost/oauth2/authorize?${params}`, {
					headers: { cookie: `user_session_id=${SESSION_ID}` }
				})
			);
			expect(authorized.status).toBe(HTTP_REDIRECT);
			const location = new URL(authorized.headers.get('location') ?? '');
			expect(location.searchParams.get('state')).toBe('test-state');
			const issued = await application.handle(
				post('/oauth2/token', {
					client_id: 'claude',
					code: location.searchParams.get('code') ?? '',
					code_verifier: VERIFIER,
					grant_type: 'authorization_code',
					redirect_uri: REDIRECT_URI,
					resource: RESOURCE
				})
			);
			expect(issued.status).toBe(HTTP_OK);
			const tokens = await issued.json();
			const claims = await verifyJwt(
				tokens.access_token,
				config.oidc.signingKey.publicJwk
			);
			expect(claims?.payload.sub).toBe('ray');
			expect(claims?.payload.aud).toBe(RESOURCE);
			const refreshed = await application.handle(
				post('/oauth2/token', {
					client_id: 'claude',
					grant_type: 'refresh_token',
					refresh_token: tokens.refresh_token,
					resource: RESOURCE
				})
			);
			expect(refreshed.status).toBe(HTTP_OK);
			const next = await refreshed.json();
			expect(next.refresh_token).not.toBe(tokens.refresh_token);
			const client = await createApiClient(apikeys.apiClientStore, {
				name: 'Enterprise',
				scopes: ['read']
			});
			const machine = await application.handle(
				post('/auth/api/token', {
					client_id: client.clientId,
					client_secret: client.clientSecret,
					grant_type: 'client_credentials',
					scope: 'read'
				})
			);
			expect(machine.status).toBe(HTTP_OK);
			const machineToken = await machine.json();
			expect(
				await verifyAccessToken(
					apikeys.accessTokenStore,
					machineToken.access_token
				)
			).toBeDefined();
			const replay = await application.handle(
				post('/oauth2/token', {
					client_id: 'claude',
					code: location.searchParams.get('code') ?? '',
					code_verifier: VERIFIER,
					grant_type: 'authorization_code',
					redirect_uri: REDIRECT_URI,
					resource: RESOURCE
				})
			);
			expect(await replay.json()).toEqual({ error: 'invalid_grant' });
		});
	}

	test('rejects explicitly overlapping routes before serving requests', async () => {
		const config = await configuration();
		await expect(
			auth({
				...config,
				apikeys: { ...config.apikeys, tokenRoute: '/oauth2/token' }
			})
		).rejects.toThrow('Conflicting auth token routes');
		await expect(
			auth({
				...config,
				apikeys: { ...config.apikeys, tokenRoute: '/custom/token/' },
				oidc: { ...config.oidc, oidcRoute: '/custom' }
			})
		).rejects.toThrow('Conflicting auth token routes');
	});

	test('allows a legacy API-only route and static API keys without a token handler', async () => {
		const config = await configuration();
		await expect(
			auth({
				apikeys: { ...config.apikeys, tokenRoute: '/oauth2/token' },
				providersConfiguration: {}
			})
		).resolves.toBeDefined();
		await expect(
			auth({ ...config, apikeys: { tokenRoute: '/oauth2/token' } })
		).resolves.toBeDefined();
	});
});
