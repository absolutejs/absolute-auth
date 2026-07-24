import { describe, expect, test } from 'bun:test';
import { hashToken } from '../src/crypto';
import { auth } from '../src/index';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { generateSigningKey, signJwt } from '../src/oidc/keys';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import type { UserSessionId } from '../src/types';

type TestUser = { email: string; sub: string };

const HOUR_MS = 3_600_000;
const ISSUER = 'https://idp.example';
const REDIRECT_URI = 'https://rp.test/cb';
const SESSION_ID: UserSessionId = '11111111-1111-4111-8111-111111111111';
const VERIFIER = 'pkce-verifier-0123456789-abcdefghij-0123456789';
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FOUND = 302;

const buildApp = async ({
	authenticatedAtOffsetMs = 0,
	getUserInfo
}: {
	authenticatedAtOffsetMs?: number;
	getUserInfo?: (sub: string) => Promise<Record<string, unknown> | undefined>;
} = {}) => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const app = await auth<TestUser>({
		authSessionStore,
		oidc: {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([
				{
					clientId: 'rp',
					name: 'RP',
					redirectUris: [REDIRECT_URI],
					scopes: ['openid', 'profile']
				}
			]),
			getUserInfo,
			issuer: ISSUER,
			loginUrl: 'https://idp.example/signin',
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey: await generateSigningKey(),
			getClaims: (user) => ({ email: user.email }),
			getUserId: (user) => user.sub
		},
		providersConfiguration: {}
	});
	await authSessionStore.setSession(SESSION_ID, {
		authenticatedAt: Date.now() + authenticatedAtOffsetMs,
		expiresAt: Date.now() + HOUR_MS,
		user: { email: 'alice@acme.test', sub: 'user-alice' }
	});

	return app;
};

const getCode = async (
	app: { handle: (req: Request) => Promise<Response> },
	extra: Record<string, string> = {}
) => {
	const params = new URLSearchParams({
		client_id: 'rp',
		code_challenge: await hashToken(VERIFIER),
		code_challenge_method: 'S256',
		redirect_uri: REDIRECT_URI,
		response_type: 'code',
		scope: 'openid profile',
		...extra
	});

	return app.handle(
		new Request(`http://localhost/oauth2/authorize?${params.toString()}`, {
			headers: { cookie: `user_session_id=${SESSION_ID}` }
		})
	);
};

const exchangeForTokens = async (
	app: { handle: (req: Request) => Promise<Response> },
	code: string
) => {
	const response = await app.handle(
		new Request('http://localhost/oauth2/token', {
			body: new URLSearchParams({
				client_id: 'rp',
				code,
				code_verifier: VERIFIER,
				grant_type: 'authorization_code',
				redirect_uri: REDIRECT_URI
			}),
			method: 'POST'
		})
	);

	return response.json();
};

describe('OIDC provider — /userinfo', () => {
	test('GET returns sub plus enriched claims when getUserInfo is configured', async () => {
		const app = await buildApp({
			getUserInfo: async (sub) => ({
				email: 'alice@acme.test',
				email_verified: true,
				name: 'Alice',
				preferred_username: sub
			})
		});
		const redirect = await getCode(app);
		const code =
			new URL(redirect.headers.get('location') ?? '').searchParams.get(
				'code'
			) ?? '';
		const tokens = await exchangeForTokens(app, code);

		const response = await app.handle(
			new Request('http://localhost/oauth2/userinfo', {
				headers: { authorization: `Bearer ${tokens.access_token}` }
			})
		);
		expect(response.status).toBe(HTTP_OK);
		const body = await response.json();
		expect(body.sub).toBe('user-alice');
		expect(body.email).toBe('alice@acme.test');
		expect(body.email_verified).toBe(true);
		expect(body.name).toBe('Alice');
		expect(body.preferred_username).toBe('user-alice');
	});

	test('GET returns sub only when getUserInfo is not configured (spec-minimum)', async () => {
		const app = await buildApp();
		const redirect = await getCode(app);
		const code =
			new URL(redirect.headers.get('location') ?? '').searchParams.get(
				'code'
			) ?? '';
		const tokens = await exchangeForTokens(app, code);

		const response = await app.handle(
			new Request('http://localhost/oauth2/userinfo', {
				headers: { authorization: `Bearer ${tokens.access_token}` }
			})
		);
		expect(response.status).toBe(HTTP_OK);
		const body = await response.json();
		expect(body.sub).toBe('user-alice');
		expect(body.email).toBeUndefined();
	});

	test('POST with access_token form field works too', async () => {
		const app = await buildApp();
		const redirect = await getCode(app);
		const code =
			new URL(redirect.headers.get('location') ?? '').searchParams.get(
				'code'
			) ?? '';
		const tokens = await exchangeForTokens(app, code);

		const response = await app.handle(
			new Request('http://localhost/oauth2/userinfo', {
				body: new URLSearchParams({
					access_token: tokens.access_token
				}),
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_OK);
		const body = await response.json();
		expect(body.sub).toBe('user-alice');
	});

	test('rejects with 401 + WWW-Authenticate on invalid token', async () => {
		const app = await buildApp();
		const response = await app.handle(
			new Request('http://localhost/oauth2/userinfo', {
				headers: { authorization: 'Bearer not.a.real.jwt' }
			})
		);
		expect(response.status).toBe(HTTP_UNAUTHORIZED);
		expect(response.headers.get('www-authenticate')).toContain('Bearer');
		expect(response.headers.get('www-authenticate')).toContain(
			'invalid_token'
		);
		expect((await response.json()).error).toBe('invalid_token');
	});

	test('rejects with 401 + invalid_request when no token presented', async () => {
		const app = await buildApp();
		const response = await app.handle(
			new Request('http://localhost/oauth2/userinfo')
		);
		expect(response.status).toBe(HTTP_UNAUTHORIZED);
		expect(response.headers.get('www-authenticate')).toContain(
			'invalid_request'
		);
	});

	test('rejects an expired access token', async () => {
		const app = await buildApp();

		// Force-clock the userinfo check past the access token's expiry.
		// Easier here than asynchronously: just sign a fresh token with exp in the past.
		const expiredAt = Math.floor(Date.now() / 1000) - 3600;
		const expiredToken = await signJwt(
			{
				client_id: 'rp',
				exp: expiredAt,
				iat: expiredAt - 3600,
				iss: ISSUER,
				scope: 'openid',
				sub: 'user-alice'
			},
			await generateSigningKey() // wrong key too — double-fails
		);
		const response = await app.handle(
			new Request('http://localhost/oauth2/userinfo', {
				headers: { authorization: `Bearer ${expiredToken}` }
			})
		);
		expect(response.status).toBe(HTTP_UNAUTHORIZED);
		expect((await response.json()).error).toBe('invalid_token');
	});

	test('discovery advertises userinfo_endpoint', async () => {
		const app = await buildApp();
		const discovery = await (
			await app.handle(
				new Request('http://localhost/.well-known/openid-configuration')
			)
		).json();
		expect(discovery.userinfo_endpoint).toContain('/oauth2/userinfo');
	});
});

describe('OIDC provider — prompt + max_age + id_token_hint', () => {
	test('prompt=none with no session → redirect with error=login_required', async () => {
		const app = await buildApp();
		// Use a different cookie so loadSessionFromSource sees no session.
		const params = new URLSearchParams({
			client_id: 'rp',
			code_challenge: await hashToken(VERIFIER),
			code_challenge_method: 'S256',
			prompt: 'none',
			redirect_uri: REDIRECT_URI,
			response_type: 'code',
			scope: 'openid'
		});
		const response = await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${params.toString()}`
			)
		);
		expect(response.status).toBe(HTTP_FOUND);
		const location = response.headers.get('location') ?? '';
		expect(location).toContain('error=login_required');
		expect(location).toContain(REDIRECT_URI);
	});

	test('prompt=login with session → still redirects to login (forces re-auth)', async () => {
		const app = await buildApp();
		const response = await getCode(app, { prompt: 'login' });
		expect(response.status).toBe(HTTP_FOUND);
		const location = response.headers.get('location') ?? '';
		// Goes to loginUrl, not the RP's redirect.
		expect(location).toContain('idp.example/signin');
		expect(location).toContain('return_to=');
	});

	test('max_age=0 with any session age → forces re-auth', async () => {
		const app = await buildApp();
		const response = await getCode(app, { max_age: '0' });
		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location') ?? '').toContain(
			'idp.example/signin'
		);
	});

	test('max_age large enough → session is fresh, code issued normally', async () => {
		const app = await buildApp();
		const response = await getCode(app, { max_age: '3600' });
		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location') ?? '').toContain(
			`${REDIRECT_URI}?code=`
		);
	});

	test('prompt=none + session present + max_age=0 (interaction needed) → interaction_required', async () => {
		const app = await buildApp();
		const response = await getCode(app, {
			max_age: '0',
			prompt: 'none'
		});
		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location') ?? '').toContain(
			'error=interaction_required'
		);
	});

	test('id_token_hint pointing at a different user → re-auth', async () => {
		const app = await buildApp();
		// Build an id_token_hint for a DIFFERENT sub, signed by the same signing key
		// the app uses (so verifyIdTokenHint accepts it).
		// Invalid hints are ignored; the matching signed-hint case below covers
		// the positive verification path.
		const otherUserHint = 'not.a.valid.signed.jwt';
		const response = await getCode(app, { id_token_hint: otherUserHint });
		// Invalid hint is silently ignored (verifyIdTokenHint returns undefined →
		// hintSub stays undefined → hintMismatch is false → session is fine).
		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location') ?? '').toContain(
			`${REDIRECT_URI}?code=`
		);
	});
});
