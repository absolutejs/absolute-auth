import { beforeEach, describe, expect, test } from 'bun:test';
import { hashToken } from '../src/crypto';
import { auth } from '../src/index';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore,
	createInMemoryPushedAuthorizationRequestStore
} from '../src/oidc/inMemoryStores';
import { generateSigningKey } from '../src/oidc/keys';
import { REQUEST_URI_PREFIX } from '../src/oidc/par';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import type { UserSessionId } from '../src/types';

type TestUser = { email: string; sub: string };

const HOUR_MS = 3_600_000;
const HTTP_OK = 200;
const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const ISSUER = 'https://idp.example';
const REDIRECT_URI = 'https://rp.test/callback';
const SESSION_ID: UserSessionId = '11111111-1111-4111-8111-111111111111';
const VERIFIER = 'pkce-verifier-0123456789-abcdefghij-0123456789';

const buildApp = async ({
	parEnabled = true,
	requirePar = false
}: { parEnabled?: boolean; requirePar?: boolean } = {}) => {
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
					requirePushedAuthorizationRequests: requirePar,
					scopes: ['openid', 'profile']
				}
			]),
			getClaims: (user) => ({ email: user.email }),
			getUserId: (user) => user.sub,
			issuer: ISSUER,
			pushedAuthorizationRequestStore: parEnabled
				? createInMemoryPushedAuthorizationRequestStore()
				: undefined,
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey: await generateSigningKey()
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

const postPar = async (
	app: { handle: (req: Request) => Promise<Response> },
	body: Record<string, string>
) =>
	app.handle(
		new Request('http://localhost/oauth2/par', {
			body: new URLSearchParams(body),
			method: 'POST'
		})
	);

describe('OIDC provider — Pushed Authorization Requests (RFC 9126)', () => {
	test('POST /par returns a request_uri + /authorize honors it', async () => {
		const app = await buildApp();
		const challenge = await hashToken(VERIFIER);
		const par = await postPar(app, {
			client_id: 'rp',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			redirect_uri: REDIRECT_URI,
			response_type: 'code',
			scope: 'openid profile',
			state: 'xyz'
		});
		expect(par.status).toBe(HTTP_OK);
		const parBody = await par.json();
		expect(parBody.request_uri).toMatch(/^urn:ietf:params:oauth:request_uri:/);
		expect(parBody.expires_in).toBeGreaterThan(0);

		const authorizeParams = new URLSearchParams({
			client_id: 'rp',
			request_uri: parBody.request_uri
		});
		const redirect = await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${authorizeParams.toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(redirect.status).toBe(HTTP_FOUND);
		const location = redirect.headers.get('location') ?? '';
		expect(location).toContain(`${REDIRECT_URI}?code=`);
		expect(location).toContain('state=xyz');
	});

	test('PAR rejects an unregistered redirect_uri', async () => {
		const app = await buildApp();
		const response = await postPar(app, {
			client_id: 'rp',
			redirect_uri: 'https://attacker.test/cb',
			response_type: 'code'
		});
		expect(response.status).toBe(HTTP_BAD_REQUEST);
		expect((await response.json()).error).toBe('invalid_redirect_uri');
	});

	test('request_uri is single-use', async () => {
		const app = await buildApp();
		const par = await (
			await postPar(app, {
				client_id: 'rp',
				code_challenge: await hashToken(VERIFIER),
				code_challenge_method: 'S256',
				redirect_uri: REDIRECT_URI,
				response_type: 'code'
			})
		).json();

		const params = new URLSearchParams({
			client_id: 'rp',
			request_uri: par.request_uri
		});

		const first = await app.handle(
			new Request(`http://localhost/oauth2/authorize?${params.toString()}`, {
				headers: { cookie: `user_session_id=${SESSION_ID}` }
			})
		);
		expect(first.status).toBe(HTTP_FOUND);
		const second = await app.handle(
			new Request(`http://localhost/oauth2/authorize?${params.toString()}`, {
				headers: { cookie: `user_session_id=${SESSION_ID}` }
			})
		);
		expect(second.status).toBe(HTTP_BAD_REQUEST);
		expect((await second.json()).error).toBe('invalid_request_uri');
	});

	test('request_uri tied to a different client is rejected', async () => {
		// Build an app where two clients are registered, but only the issuing client
		// can redeem the URI.
		const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
		const app = await auth<TestUser>({
			authSessionStore,
			oidc: {
				authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
				clientStore: createInMemoryOAuthClientStore([
					{
						clientId: 'rp-a',
						name: 'RP A',
						redirectUris: [REDIRECT_URI],
						scopes: ['openid']
					},
					{
						clientId: 'rp-b',
						name: 'RP B',
						redirectUris: [REDIRECT_URI],
						scopes: ['openid']
					}
				]),
				getClaims: (user) => ({ email: user.email }),
				getUserId: (user) => user.sub,
				issuer: ISSUER,
				pushedAuthorizationRequestStore:
					createInMemoryPushedAuthorizationRequestStore(),
				refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
				signingKey: await generateSigningKey()
			},
			providersConfiguration: {}
		});
		await authSessionStore.setSession(SESSION_ID, {
			authenticatedAt: Date.now(),
			expiresAt: Date.now() + HOUR_MS,
			user: { email: 'alice@acme.test', sub: 'user-alice' }
		});

		const par = await (
			await postPar(app, {
				client_id: 'rp-a',
				code_challenge: await hashToken(VERIFIER),
				code_challenge_method: 'S256',
				redirect_uri: REDIRECT_URI,
				response_type: 'code'
			})
		).json();

		// rp-b tries to redeem rp-a's URI.
		const stolen = new URLSearchParams({
			client_id: 'rp-b',
			request_uri: par.request_uri
		});
		const response = await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${stolen.toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(response.status).toBe(HTTP_BAD_REQUEST);
		expect((await response.json()).error).toBe('invalid_request_uri');
	});

	test('client with requirePushedAuthorizationRequests rejects plain /authorize', async () => {
		const app = await buildApp({ requirePar: true });
		const params = new URLSearchParams({
			client_id: 'rp',
			code_challenge: await hashToken(VERIFIER),
			code_challenge_method: 'S256',
			redirect_uri: REDIRECT_URI,
			response_type: 'code'
		});
		const response = await app.handle(
			new Request(`http://localhost/oauth2/authorize?${params.toString()}`, {
				headers: { cookie: `user_session_id=${SESSION_ID}` }
			})
		);
		expect(response.status).toBe(HTTP_FOUND);
		const location = response.headers.get('location') ?? '';
		expect(location).toContain('error=invalid_request');
	});

	test('discovery advertises the par endpoint when configured', async () => {
		const app = await buildApp();
		const discovery = await (
			await app.handle(
				new Request('http://localhost/.well-known/openid-configuration')
			)
		).json();
		expect(discovery.pushed_authorization_request_endpoint).toContain(
			'/oauth2/par'
		);
		expect(
			discovery.require_pushed_authorization_requests_supported
		).toBe(true);
	});

	test('discovery omits par when not configured', async () => {
		const app = await buildApp({ parEnabled: false });
		const discovery = await (
			await app.handle(
				new Request('http://localhost/.well-known/openid-configuration')
			)
		).json();
		expect(discovery.pushed_authorization_request_endpoint).toBeUndefined();
	});

	test('a request_uri shape with PAR disabled is rejected at /authorize', async () => {
		const app = await buildApp({ parEnabled: false });
		const params = new URLSearchParams({
			client_id: 'rp',
			request_uri: `${REQUEST_URI_PREFIX}fabricated-token`
		});
		const response = await app.handle(
			new Request(`http://localhost/oauth2/authorize?${params.toString()}`, {
				headers: { cookie: `user_session_id=${SESSION_ID}` }
			})
		);
		expect(response.status).toBe(HTTP_BAD_REQUEST);
	});
});
