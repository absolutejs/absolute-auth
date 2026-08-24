import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { CredentialsConfig } from '../src/credentials/config';
import { credentialsLogin } from '../src/credentials/login';
import { credentialsRegister } from '../src/credentials/register';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { requireAuthPlugin } from '../src/routes/requireAuth';
import { generateSigningKey } from '../src/oidc/keys';
import { issueTokenSet, type OidcProviderConfig } from '../src/oidc/config';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';

type TestUser = { email: string; sub: string };

// A route defined AFTER `.use(requireAuthPlugin())` must be guarded by mounting
// alone — the handler has no per-route auth check, which is exactly the case
// protectRoutePlugin would leave public.
const buildApp = () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const users = new Map<string, TestUser>();
	const config: CredentialsConfig<TestUser> = {
		credentialStore: createInMemoryCredentialStore(),
		passwordPolicy: { minLength: 8 },
		getUserByEmail: (email) => users.get(email) ?? null,
		onCreateCredentialUser: ({ email }) => {
			const user = { email, sub: `user:${email}` };
			users.set(email, user);

			return user;
		},
		onSendEmail: () => undefined
	};

	return new Elysia()
		.use(credentialsRegister({ ...config, authSessionStore }))
		.use(credentialsLogin({ ...config, authSessionStore }))
		.use(requireAuthPlugin<TestUser>({ authSessionStore }))
		.get('/secret', ({ user }) => ({ ok: true, sub: user?.sub ?? null }));
};

const post = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	body: unknown
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		})
	);

const sessionCookie = (response: Response) =>
	response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith('user_session_id='))
		?.split(';')[0] ?? '';

describe('requireAuthPlugin fails closed by default (F7)', () => {
	test('an unguarded handler mounted under it rejects an anonymous request', async () => {
		const app = buildApp();
		const res = await app.handle(new Request('http://localhost/secret'));
		expect(res.status).not.toBe(200);
		expect(res.status).toBe(401);
	});

	test('a well-formed but unknown session cookie is rejected', async () => {
		const app = buildApp();
		const res = await app.handle(
			new Request('http://localhost/secret', {
				headers: {
					cookie: 'user_session_id=00000000-0000-0000-0000-000000000000'
				}
			})
		);
		expect(res.status).not.toBe(200);
	});

	test('an authenticated request passes and exposes ctx.user', async () => {
		const app = buildApp();
		await post(app, '/auth/register', {
			email: 'a@b.com',
			password: 'password123'
		});
		const login = await post(app, '/auth/login', {
			email: 'a@b.com',
			password: 'password123'
		});
		const cookie = sessionCookie(login);
		expect(cookie).toContain('user_session_id=');

		const res = await app.handle(
			new Request('http://localhost/secret', { headers: { cookie } })
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			ok: true,
			sub: 'user:a@b.com'
		});
	});

	test('accepts an audience-bound mobile token and exposes the normalized principal', async () => {
		const signingKey = await generateSigningKey();
		const user = { email: 'mobile@example.com', sub: 'mobile-user' };
		const oidc: OidcProviderConfig<TestUser> = {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([]),
			issuer: 'https://api.example',
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey,
			getUserId: (candidate) => candidate.sub
		};
		const tokens = await issueTokenSet({
			audience: oidc.issuer,
			clientId: 'native-client',
			config: oidc,
			scopes: ['openid', 'account:read'],
			sub: user.sub
		});
		const app = new Elysia()
			.use(
				requireAuthPlugin<TestUser>({
					accessTokens: {
						oidc,
						getUser: (subject) =>
							subject === user.sub ? user : null
					}
				})
			)
			.get('/mobile-secret', ({ authPrincipal, user: resolved }) => ({
				kind: authPrincipal?.kind,
				scopes:
					authPrincipal?.kind === 'access-token'
						? authPrincipal.scopes
						: [],
				sub: resolved?.sub
			}));

		const response = await app.handle(
			new Request('http://localhost/mobile-secret', {
				headers: { authorization: `Bearer ${tokens.access_token}` }
			})
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			kind: 'access-token',
			scopes: ['openid', 'account:read'],
			sub: user.sub
		});
	});

	test('rejects a validly signed token for a different resource audience', async () => {
		const signingKey = await generateSigningKey();
		const oidc: OidcProviderConfig<TestUser> = {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([]),
			issuer: 'https://api.example',
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey,
			getUserId: (candidate) => candidate.sub
		};
		const tokens = await issueTokenSet({
			audience: 'https://other-resource.example',
			clientId: 'native-client',
			config: oidc,
			scopes: ['openid'],
			sub: 'mobile-user'
		});
		const app = new Elysia()
			.use(
				requireAuthPlugin<TestUser>({
					accessTokens: {
						oidc,
						getUser: () => ({
							email: 'mobile@example.com',
							sub: 'mobile-user'
						})
					}
				})
			)
			.get('/mobile-secret', () => ({ ok: true }));

		const response = await app.handle(
			new Request('http://localhost/mobile-secret', {
				headers: { authorization: `Bearer ${tokens.access_token}` }
			})
		);
		expect(response.status).toBe(401);
	});
});
