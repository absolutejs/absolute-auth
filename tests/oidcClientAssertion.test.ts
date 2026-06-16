import { beforeEach, describe, expect, test } from 'bun:test';
import { hashToken } from '../src/crypto';
import { auth } from '../src/index';
import {
	CLIENT_ASSERTION_TYPE,
	verifyClientAssertion
} from '../src/oidc/clientAuth';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryClientAssertionJtiStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { generateSigningKey, signJwt, toPublicJwk } from '../src/oidc/keys';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import type { UserSessionId } from '../src/types';

type TestUser = { email: string; sub: string };

const HOUR_MS = 3_600_000;
const ISSUER = 'https://idp.example';
const REDIRECT_URI = 'https://rp.example/cb';
const SESSION_ID: UserSessionId = '11111111-1111-4111-8111-111111111111';
const VERIFIER = 'pkce-verifier-0123456789-abcdefghij-0123456789';

const buildClientAssertion = async ({
	audience,
	clientId,
	clientSigningKey,
	expSeconds,
	jti
}: {
	audience: string;
	clientId: string;
	clientSigningKey: Awaited<ReturnType<typeof generateSigningKey>>;
	expSeconds?: number;
	jti?: string;
}) =>
	signJwt(
		{
			aud: audience,
			exp: expSeconds ?? Math.floor(Date.now() / 1000) + 60,
			iat: Math.floor(Date.now() / 1000),
			iss: clientId,
			jti: jti ?? crypto.randomUUID(),
			sub: clientId
		},
		clientSigningKey
	);

const buildApp = async (clientPublicJwk: JsonWebKey) => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const signingKey = await generateSigningKey();
	const app = await auth<TestUser>({
		authSessionStore,
		oidc: {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientAssertionJtiStore: createInMemoryClientAssertionJtiStore(),
			clientStore: createInMemoryOAuthClientStore([
				{
					clientId: 'rp-with-keys',
					jwks: [clientPublicJwk],
					name: 'RP with JWKS',
					redirectUris: [REDIRECT_URI],
					scopes: ['openid']
				}
			]),
			getClaims: (user) => ({ email: user.email }),
			getUserId: (user) => user.sub,
			issuer: ISSUER,
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey
		},
		providersConfiguration: {}
	});
	await authSessionStore.setSession(SESSION_ID, {
		authenticatedAt: Date.now(),
		expiresAt: Date.now() + HOUR_MS,
		user: { email: 'alice@acme.test', sub: 'user-alice' }
	});

	return app;
};

const codeFromRedirect = (response: Response) =>
	new URL(response.headers.get('location') ?? '').searchParams.get('code') ??
	'';

const getCode = async (app: {
	handle: (req: Request) => Promise<Response>;
}) => {
	const params = new URLSearchParams({
		client_id: 'rp-with-keys',
		code_challenge: await hashToken(VERIFIER),
		code_challenge_method: 'S256',
		redirect_uri: REDIRECT_URI,
		response_type: 'code',
		scope: 'openid'
	});

	return codeFromRedirect(
		await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${params.toString()}`,
				{
					headers: { cookie: `user_session_id=${SESSION_ID}` }
				}
			)
		)
	);
};

describe('OIDC provider — private_key_jwt client auth (RFC 7521/7523)', () => {
	let clientKey: Awaited<ReturnType<typeof generateSigningKey>>;
	let app: { handle: (req: Request) => Promise<Response> };

	beforeEach(async () => {
		clientKey = await generateSigningKey();
		app = await buildApp(toPublicJwk(clientKey));
	});

	test('exchanges authorization code using a signed client_assertion', async () => {
		const code = await getCode(app);
		const assertion = await buildClientAssertion({
			audience: `${ISSUER}/oauth2/token`,
			clientId: 'rp-with-keys',
			clientSigningKey: clientKey
		});

		const response = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					client_assertion: assertion,
					client_assertion_type: CLIENT_ASSERTION_TYPE,
					code,
					code_verifier: VERIFIER,
					grant_type: 'authorization_code',
					redirect_uri: REDIRECT_URI
				}),
				method: 'POST'
			})
		);
		expect(response.status).toBe(200);
		const tokens = await response.json();
		expect(tokens.access_token).toBeTruthy();
	});

	test('rejects an assertion signed by the wrong key', async () => {
		const attackerKey = await generateSigningKey();
		const assertion = await buildClientAssertion({
			audience: `${ISSUER}/oauth2/token`,
			clientId: 'rp-with-keys',
			clientSigningKey: attackerKey
		});

		const response = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					client_assertion: assertion,
					client_assertion_type: CLIENT_ASSERTION_TYPE,
					grant_type: 'authorization_code'
				}),
				method: 'POST'
			})
		);
		expect(response.status).toBe(401);
	});

	test('rejects an assertion with the wrong audience', async () => {
		const assertion = await buildClientAssertion({
			audience: 'https://other-idp.example/oauth2/token',
			clientId: 'rp-with-keys',
			clientSigningKey: clientKey
		});

		const response = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					client_assertion: assertion,
					client_assertion_type: CLIENT_ASSERTION_TYPE,
					grant_type: 'authorization_code'
				}),
				method: 'POST'
			})
		);
		expect(response.status).toBe(401);
	});

	test('rejects an expired assertion', async () => {
		const assertion = await buildClientAssertion({
			audience: `${ISSUER}/oauth2/token`,
			clientId: 'rp-with-keys',
			clientSigningKey: clientKey,
			expSeconds: Math.floor(Date.now() / 1000) - 60
		});

		const response = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					client_assertion: assertion,
					client_assertion_type: CLIENT_ASSERTION_TYPE,
					grant_type: 'authorization_code'
				}),
				method: 'POST'
			})
		);
		expect(response.status).toBe(401);
	});

	test('rejects a replayed jti within its validity window', async () => {
		const code = await getCode(app);
		const jti = crypto.randomUUID();
		const assertion = await buildClientAssertion({
			audience: `${ISSUER}/oauth2/token`,
			clientId: 'rp-with-keys',
			clientSigningKey: clientKey,
			jti
		});

		const first = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					client_assertion: assertion,
					client_assertion_type: CLIENT_ASSERTION_TYPE,
					code,
					code_verifier: VERIFIER,
					grant_type: 'authorization_code',
					redirect_uri: REDIRECT_URI
				}),
				method: 'POST'
			})
		);
		expect(first.status).toBe(200);

		// Replay the same assertion (same jti).
		const replay = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					client_assertion: assertion,
					client_assertion_type: CLIENT_ASSERTION_TYPE,
					grant_type: 'refresh_token',
					refresh_token: 'irrelevant'
				}),
				method: 'POST'
			})
		);
		expect(replay.status).toBe(401);
	});

	test('discovery advertises private_key_jwt + ES256', async () => {
		const discovery = await (
			await app.handle(
				new Request('http://localhost/.well-known/openid-configuration')
			)
		).json();
		expect(discovery.token_endpoint_auth_methods_supported).toContain(
			'private_key_jwt'
		);
		expect(
			discovery.token_endpoint_auth_signing_alg_values_supported
		).toContain('ES256');
	});

	test('verifyClientAssertion exports cleanly for consumer reuse', async () => {
		const assertion = await buildClientAssertion({
			audience: 'https://elsewhere.example/token',
			clientId: 'rp-with-keys',
			clientSigningKey: clientKey
		});
		const result = await verifyClientAssertion({
			assertion,
			expectedAudience: 'https://elsewhere.example/token',
			resolveClient: async () => ({
				clientId: 'rp-with-keys',
				jwks: [toPublicJwk(clientKey)],
				name: 'rp',
				redirectUris: [],
				scopes: []
			})
		});
		expect(result?.clientId).toBe('rp-with-keys');
	});
});
