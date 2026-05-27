import { beforeEach, describe, expect, test } from 'bun:test';
import { hashToken } from '../src/crypto';
import { auth } from '../src/index';
import { generateSigningKey, jwkThumbprint, verifyJwt } from '../src/oidc/keys';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryDeviceAuthorizationStore,
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

type ClaimsHook = (context: {
	audience?: string;
	clientId: string;
	scopes: string[];
	sub: string;
}) => Record<string, unknown> | Promise<Record<string, unknown>>;

const buildApp = async (
	extras: {
		deviceFlow?: boolean;
		getAccessTokenClaims?: ClaimsHook;
	} = {}
) => {
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
			deviceAuthorizationStore:
				extras.deviceFlow === true
					? createInMemoryDeviceAuthorizationStore()
					: undefined,
			getAccessTokenClaims: extras.getAccessTokenClaims,
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

	test('getAccessTokenClaims merges custom claims; reserved claims are protected', async () => {
		const customApp = await buildApp({
			// try to also smuggle in `sub` (reserved) — must be ignored
			getAccessTokenClaims: ({ sub }) => ({
				email: 'alice@acme.test',
				org_id: 'org_acme',
				sub: 'NOT-THE-REAL-SUB',
				tenant_tier: 'enterprise',
				viewed_sub: sub
			})
		});

		const challenge = await hashToken(VERIFIER);
		const code = codeFromRedirect(
			await authorize(customApp, challenge, `user_session_id=${SESSION_ID}`)
		);
		const tokens = await (
			await token(customApp, {
				client_id: 'app1',
				code,
				code_verifier: VERIFIER,
				grant_type: 'authorization_code',
				redirect_uri: REDIRECT_URI
			})
		).json();
		const jwks = await (
			await customApp.handle(new Request('http://localhost/oauth2/jwks'))
		).json();
		const accessToken = await verifyJwt(tokens.access_token, jwks.keys[0]);

		expect(accessToken?.payload.email).toBe('alice@acme.test');
		expect(accessToken?.payload.org_id).toBe('org_acme');
		expect(accessToken?.payload.tenant_tier).toBe('enterprise');
		expect(accessToken?.payload.viewed_sub).toBe('user-alice');
		// Reserved claims wins protection: sub stays the real user, not the smuggled value.
		expect(accessToken?.payload.sub).toBe('user-alice');
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

	test('authorization response carries RFC 9207 iss parameter (mix-up defense)', async () => {
		const challenge = await hashToken(VERIFIER);
		const redirect = await authorize(
			app,
			challenge,
			`user_session_id=${SESSION_ID}`
		);
		expect(redirect.status).toBe(302);
		const location = redirect.headers.get('location') ?? '';
		const url = new URL(location);
		expect(url.searchParams.get('iss')).toBe(ISSUER);
		// Error responses also carry iss — exercise via unsupported_response_type.
		const badParams = new URLSearchParams({
			client_id: 'app1',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			redirect_uri: REDIRECT_URI,
			response_type: 'token',
			scope: 'openid',
			state: 'state-err'
		});
		const errorResponse = await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${badParams.toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(errorResponse.status).toBe(302);
		const errorUrl = new URL(errorResponse.headers.get('location') ?? '');
		expect(errorUrl.searchParams.get('error')).toBe(
			'unsupported_response_type'
		);
		expect(errorUrl.searchParams.get('iss')).toBe(ISSUER);
	});

	test('form_post response_mode returns auto-submitting HTML with code + state', async () => {
		const challenge = await hashToken(VERIFIER);
		const params = new URLSearchParams({
			client_id: 'app1',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			nonce: 'nonce-fp',
			redirect_uri: REDIRECT_URI,
			response_mode: 'form_post',
			response_type: 'code',
			scope: 'openid',
			state: 'state-fp"with-quote'
		});
		const response = await app.handle(
			new Request(`http://localhost/oauth2/authorize?${params.toString()}`, {
				headers: { cookie: `user_session_id=${SESSION_ID}` }
			})
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
		const html = await response.text();
		// Auto-submit shell
		expect(html).toContain('<form method="post"');
		expect(html).toContain(`action="${REDIRECT_URI}"`);
		expect(html).toContain('document.forms[0].submit()');
		// State is HTML-attribute escaped (`"` → `&quot;`)
		expect(html).toContain(
			'name="state" value="state-fp&quot;with-quote"'
		);
		// code is present + non-empty
		const codeMatch = html.match(/name="code" value="([^"]+)"/);
		expect(codeMatch).not.toBeNull();
		expect((codeMatch?.[1] ?? '').length).toBeGreaterThan(0);
	});

	test('unsupported response_mode is rejected with invalid_request error code', async () => {
		const challenge = await hashToken(VERIFIER);
		const params = new URLSearchParams({
			client_id: 'app1',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			nonce: 'nonce-bad-mode',
			redirect_uri: REDIRECT_URI,
			response_mode: 'fragment',
			response_type: 'code',
			scope: 'openid',
			state: 'state-bad'
		});
		const response = await app.handle(
			new Request(`http://localhost/oauth2/authorize?${params.toString()}`, {
				headers: { cookie: `user_session_id=${SESSION_ID}` }
			})
		);

		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBe('unsupported_response_mode');
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
		expect(discovery.response_modes_supported).toEqual(['query', 'form_post']);
		expect(discovery.authorization_response_iss_parameter_supported).toBe(
			true
		);

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
			subject_token_type: 'urn:ietf:params:oauth:token-type:access_token'
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

describe('OIDC provider — RFC 7662 introspection', () => {
	test('returns active: true for a valid access token (JWT)', async () => {
		const app = await buildApp();
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

		const response = await app.handle(
			new Request('http://localhost/oauth2/introspect', {
				body: new URLSearchParams({
					client_id: 'app1',
					token: tokens.access_token
				}),
				method: 'POST'
			})
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.active).toBe(true);
		expect(body.sub).toBe('user-alice');
		expect(body.token_type).toBe('access_token');
		expect(body.scope).toBe('openid profile');
	});

	test('returns active: true for a valid refresh token + active: false after revoke', async () => {
		const app = await buildApp();
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

		// Introspect the refresh token.
		const first = await (
			await app.handle(
				new Request('http://localhost/oauth2/introspect', {
					body: new URLSearchParams({
						client_id: 'app1',
						token: tokens.refresh_token,
						token_type_hint: 'refresh_token'
					}),
					method: 'POST'
				})
			)
		).json();
		expect(first.active).toBe(true);
		expect(first.token_type).toBe('refresh_token');

		// Revoke (RFC 7009) — refresh token should now be gone.
		const revoke = await app.handle(
			new Request('http://localhost/oauth2/revoke', {
				body: new URLSearchParams({
					client_id: 'app1',
					token: tokens.refresh_token,
					token_type_hint: 'refresh_token'
				}),
				method: 'POST'
			})
		);
		expect(revoke.status).toBe(200);

		const second = await (
			await app.handle(
				new Request('http://localhost/oauth2/introspect', {
					body: new URLSearchParams({
						client_id: 'app1',
						token: tokens.refresh_token,
						token_type_hint: 'refresh_token'
					}),
					method: 'POST'
				})
			)
		).json();
		expect(second.active).toBe(false);
	});

	test('returns active: false for garbage tokens', async () => {
		const app = await buildApp();
		const body = await (
			await app.handle(
				new Request('http://localhost/oauth2/introspect', {
					body: new URLSearchParams({
						client_id: 'app1',
						token: 'not.a.token'
					}),
					method: 'POST'
				})
			)
		).json();
		expect(body.active).toBe(false);
	});

	test('rejects unknown clients with 401', async () => {
		const app = await buildApp();
		const response = await app.handle(
			new Request('http://localhost/oauth2/introspect', {
				body: new URLSearchParams({
					client_id: 'nope',
					token: 'whatever'
				}),
				method: 'POST'
			})
		);
		expect(response.status).toBe(401);
	});
});

describe('OIDC provider — RFC 8628 device authorization', () => {
	test('end-to-end: device_authorization → approve → exchange device_code', async () => {
		const app = await buildApp({ deviceFlow: true });

		// 1. Device requests authorization.
		const auth1 = await app.handle(
			new Request('http://localhost/oauth2/device_authorization', {
				body: new URLSearchParams({
					client_id: 'app1',
					scope: 'openid profile'
				}),
				method: 'POST'
			})
		);
		expect(auth1.status).toBe(200);
		const grant = await auth1.json();
		expect(grant.device_code).toBeTruthy();
		expect(grant.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
		expect(grant.interval).toBeGreaterThan(0);

		// 2. Polling before approval returns authorization_pending.
		const pending = await token(app, {
			client_id: 'app1',
			device_code: grant.device_code,
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
		});
		expect(pending.status).toBe(400);
		expect((await pending.json()).error).toBe('authorization_pending');

		// 3. User approves on the verification UI (which is consumer-built;
		// here we hit the internal /device/decision endpoint with a session).
		const approve = await app.handle(
			new Request('http://localhost/oauth2/device/decision', {
				body: new URLSearchParams({
					action: 'approve',
					user_code: grant.user_code
				}),
				headers: { cookie: `user_session_id=${SESSION_ID}` },
				method: 'POST'
			})
		);
		expect(approve.status).toBe(200);

		// 4. Polling after approval mints a full token set.
		const granted = await token(app, {
			client_id: 'app1',
			device_code: grant.device_code,
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
		});
		expect(granted.status).toBe(200);
		const tokens = await granted.json();
		expect(tokens.access_token).toBeTruthy();
		expect(tokens.refresh_token).toBeTruthy();
		expect(tokens.id_token).toBeTruthy();

		const jwks = await (
			await app.handle(new Request('http://localhost/oauth2/jwks'))
		).json();
		const decoded = await verifyJwt(tokens.access_token, jwks.keys[0]);
		expect(decoded?.payload.sub).toBe('user-alice');

		// 5. Single-use: a second exchange with the same device_code fails.
		const replay = await token(app, {
			client_id: 'app1',
			device_code: grant.device_code,
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
		});
		expect(replay.status).toBe(400);
		expect((await replay.json()).error).toBe('invalid_grant');
	});

	test('user denies → access_denied', async () => {
		const app = await buildApp({ deviceFlow: true });
		const grant = await (
			await app.handle(
				new Request('http://localhost/oauth2/device_authorization', {
					body: new URLSearchParams({ client_id: 'app1' }),
					method: 'POST'
				})
			)
		).json();
		await app.handle(
			new Request('http://localhost/oauth2/device/decision', {
				body: new URLSearchParams({
					action: 'deny',
					user_code: grant.user_code
				}),
				headers: { cookie: `user_session_id=${SESSION_ID}` },
				method: 'POST'
			})
		);
		const response = await token(app, {
			client_id: 'app1',
			device_code: grant.device_code,
			grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('access_denied');
	});

	test('device flow is opt-in — disabled when no store is configured', async () => {
		const app = await buildApp({ deviceFlow: false });
		const response = await app.handle(
			new Request('http://localhost/oauth2/device_authorization', {
				body: new URLSearchParams({ client_id: 'app1' }),
				method: 'POST'
			})
		);
		expect(response.status).toBe(400);
		expect((await response.json()).error).toBe('unsupported_grant_type');
	});

	test('discovery advertises new endpoints when device flow is enabled', async () => {
		const app = await buildApp({ deviceFlow: true });
		const discovery = await (
			await app.handle(
				new Request(
					'http://localhost/.well-known/openid-configuration'
				)
			)
		).json();
		expect(discovery.introspection_endpoint).toContain('/oauth2/introspect');
		expect(discovery.revocation_endpoint).toContain('/oauth2/revoke');
		expect(discovery.device_authorization_endpoint).toContain(
			'/oauth2/device_authorization'
		);
		expect(discovery.grant_types_supported).toContain(
			'urn:ietf:params:oauth:grant-type:device_code'
		);
	});
});
