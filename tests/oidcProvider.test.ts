import { beforeEach, describe, expect, test } from 'bun:test';
import { hashToken } from '../src/crypto';
import { auth } from '../src/index';
import { generateSigningKey, jwkThumbprint, verifyJwt } from '../src/oidc/keys';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import type { UserSessionId } from '../src/types';

type TestUser = { email: string; sub: string };

const HOUR_MS = 3_600_000;
const SESSION_ID: UserSessionId = '11111111-1111-4111-8111-111111111111';
const ISSUER = 'https://idp.example';
const REDIRECT_URI = 'https://app.example/callback';
const VERIFIER = 'pkce-verifier-0123456789-abcdefghij-0123456789';

const buildApp = async () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const signingKey = await generateSigningKey();
	const app = await auth<TestUser>({
		authSessionStore,
		oidc: {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([
				{
					clientId: 'app1',
					name: 'Demo App',
					redirectUris: [REDIRECT_URI],
					scopes: ['openid', 'profile']
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

const authorize = (
	app: { handle: (request: Request) => Promise<Response> },
	challenge: string,
	cookie: string
) => {
	const params = new URLSearchParams({
		client_id: 'app1',
		code_challenge: challenge,
		code_challenge_method: 'S256',
		nonce: 'nonce-123',
		redirect_uri: REDIRECT_URI,
		response_type: 'code',
		scope: 'openid profile',
		state: 'state-xyz'
	});

	return app.handle(
		new Request(`http://localhost/oauth2/authorize?${params.toString()}`, {
			headers: { cookie }
		})
	);
};

const token = (
	app: { handle: (request: Request) => Promise<Response> },
	body: Record<string, string>,
	dpop?: string
) =>
	app.handle(
		new Request('http://localhost/oauth2/token', {
			body: new URLSearchParams(body),
			headers: dpop === undefined ? {} : { dpop },
			method: 'POST'
		})
	);

const codeFromRedirect = (response: Response) => {
	const location = response.headers.get('location') ?? '';

	return new URL(location).searchParams.get('code') ?? '';
};

describe('OIDC provider', () => {
	let app = { handle: async () => new Response() };

	beforeEach(async () => {
		app = await buildApp();
	});

	test('authorization_code + PKCE issues verifiable id/access tokens', async () => {
		const challenge = await hashToken(VERIFIER);
		const redirect = await authorize(
			app,
			challenge,
			`user_session_id=${SESSION_ID}`
		);
		expect(redirect.status).toBe(302);
		const code = codeFromRedirect(redirect);
		expect(code.length).toBeGreaterThan(0);

		const tokenResponse = await token(app, {
			client_id: 'app1',
			code,
			code_verifier: VERIFIER,
			grant_type: 'authorization_code',
			redirect_uri: REDIRECT_URI
		});
		expect(tokenResponse.status).toBe(200);
		const tokens = await tokenResponse.json();
		expect(tokens.token_type).toBe('Bearer');

		const jwks = await (
			await app.handle(new Request('http://localhost/oauth2/jwks'))
		).json();
		const idToken = await verifyJwt(tokens.id_token, jwks.keys[0]);
		expect(idToken?.payload.sub).toBe('user-alice');
		expect(idToken?.payload.nonce).toBe('nonce-123');
		expect(idToken?.payload.email).toBe('alice@acme.test');
		expect(idToken?.payload.iss).toBe(ISSUER);

		const accessToken = await verifyJwt(tokens.access_token, jwks.keys[0]);
		expect(accessToken?.payload.scope).toBe('openid profile');
	});

	test('rejects a wrong PKCE verifier', async () => {
		const challenge = await hashToken(VERIFIER);
		const code = codeFromRedirect(
			await authorize(app, challenge, `user_session_id=${SESSION_ID}`)
		);

		const tokenResponse = await token(app, {
			client_id: 'app1',
			code,
			code_verifier: 'the-wrong-verifier-aaaaaaaaaaaaaaaaaaaaaa',
			grant_type: 'authorization_code',
			redirect_uri: REDIRECT_URI
		});
		expect(tokenResponse.status).toBe(400);
	});

	test('unauthenticated authorize redirects to login', async () => {
		const challenge = await hashToken(VERIFIER);
		const redirect = await authorize(app, challenge, '');
		// no loginUrl configured -> 401 login_required
		expect(redirect.status).toBe(401);
	});

	test('refresh token rotates and the old one is rejected', async () => {
		const challenge = await hashToken(VERIFIER);
		const code = codeFromRedirect(
			await authorize(app, challenge, `user_session_id=${SESSION_ID}`)
		);
		const tokens = await (
			await token(app, {
				client_id: 'app1',
				code,
				code_verifier: VERIFIER,
				grant_type: 'authorization_code',
				redirect_uri: REDIRECT_URI
			})
		).json();

		const refreshed = await (
			await token(app, {
				client_id: 'app1',
				grant_type: 'refresh_token',
				refresh_token: tokens.refresh_token
			})
		).json();
		expect(typeof refreshed.access_token).toBe('string');
		expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);

		const reuse = await token(app, {
			client_id: 'app1',
			grant_type: 'refresh_token',
			refresh_token: tokens.refresh_token
		});
		expect(reuse.status).toBe(400);
	});

	test('discovery + jwks describe the provider', async () => {
		const discovery = await (
			await app.handle(
				new Request('http://localhost/.well-known/openid-configuration')
			)
		).json();
		expect(discovery.issuer).toBe(ISSUER);
		expect(discovery.code_challenge_methods_supported).toContain('S256');
		expect(discovery.dpop_signing_alg_values_supported).toContain('ES256');

		const jwks = await (
			await app.handle(new Request('http://localhost/oauth2/jwks'))
		).json();
		expect(jwks.keys[0].kty).toBe('EC');
		expect(jwks.keys[0].use).toBe('sig');
	});

	test('DPoP binds the access token to the proof key (cnf.jkt)', async () => {
		const challenge = await hashToken(VERIFIER);
		const code = codeFromRedirect(
			await authorize(app, challenge, `user_session_id=${SESSION_ID}`)
		);

		const pair = await crypto.subtle.generateKey(
			{ name: 'ECDSA', namedCurve: 'P-256' },
			true,
			['sign', 'verify']
		);
		const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
		const segment = (value: unknown) =>
			Buffer.from(JSON.stringify(value)).toString('base64url');
		const header = segment({
			alg: 'ES256',
			jwk: publicJwk,
			typ: 'dpop+jwt'
		});
		const payload = segment({
			htm: 'POST',
			htu: `${ISSUER}/oauth2/token`,
			iat: Math.floor(Date.now() / 1000),
			jti: crypto.randomUUID()
		});
		const signature = await crypto.subtle.sign(
			{ hash: 'SHA-256', name: 'ECDSA' },
			pair.privateKey,
			new TextEncoder().encode(`${header}.${payload}`)
		);
		const proof = `${header}.${payload}.${Buffer.from(
			new Uint8Array(signature)
		).toString('base64url')}`;

		const tokens = await (
			await token(
				app,
				{
					client_id: 'app1',
					code,
					code_verifier: VERIFIER,
					grant_type: 'authorization_code',
					redirect_uri: REDIRECT_URI
				},
				proof
			)
		).json();
		expect(tokens.token_type).toBe('DPoP');

		const jwks = await (
			await app.handle(new Request('http://localhost/oauth2/jwks'))
		).json();
		const accessToken = await verifyJwt(tokens.access_token, jwks.keys[0]);
		expect(accessToken?.payload.cnf.jkt).toBe(
			await jwkThumbprint(publicJwk)
		);
	});
});

const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';

describe('OIDC token exchange (RFC 8693) — AI-agent / MCP delegation', () => {
	let app = { handle: async () => new Response() };

	beforeEach(async () => {
		app = await buildApp();
	});

	const getUserAccessToken = async () => {
		const challenge = await hashToken(VERIFIER);
		const code = codeFromRedirect(
			await authorize(app, challenge, `user_session_id=${SESSION_ID}`)
		);
		const tokens = await (
			await token(app, {
				client_id: 'app1',
				code,
				code_verifier: VERIFIER,
				grant_type: 'authorization_code',
				redirect_uri: REDIRECT_URI
			})
		).json();

		return tokens.access_token;
	};

	test('exchanges a user token for a narrowed, audience-bound delegated token', async () => {
		const userToken = await getUserAccessToken();
		const response = await token(app, {
			audience: 'https://api.example/mcp',
			client_id: 'app1',
			grant_type: TOKEN_EXCHANGE,
			scope: 'openid',
			subject_token: userToken,
			subject_token_type:
				'urn:ietf:params:oauth:token-type:access_token'
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.issued_token_type).toBe(
			'urn:ietf:params:oauth:token-type:access_token'
		);
		expect(body.scope).toBe('openid'); // narrowed from "openid profile"

		const jwks = await (
			await app.handle(new Request('http://localhost/oauth2/jwks'))
		).json();
		const decoded = await verifyJwt(body.access_token, jwks.keys[0]);
		expect(decoded?.payload.sub).toBe('user-alice'); // still the user
		expect(decoded?.payload.aud).toBe('https://api.example/mcp'); // RFC 8707
		expect(decoded?.payload.act.sub).toBe('app1'); // RFC 8693 delegation
	});

	test('rejects a scope outside the subject token', async () => {
		const userToken = await getUserAccessToken();
		const response = await token(app, {
			client_id: 'app1',
			grant_type: TOKEN_EXCHANGE,
			scope: 'admin:write',
			subject_token: userToken
		});
		expect(response.status).toBe(400);
	});

	test('rejects an invalid subject token', async () => {
		const response = await token(app, {
			client_id: 'app1',
			grant_type: TOKEN_EXCHANGE,
			subject_token: 'not.a.real.jwt'
		});
		expect(response.status).toBe(400);
	});
});
