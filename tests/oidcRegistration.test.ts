import { beforeEach, describe, expect, test } from 'bun:test';
import { hashToken } from '../src/crypto';
import { auth } from '../src/index';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryClientRegistrationTokenStore,
	createInMemoryInitialAccessTokenStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { generateSigningKey } from '../src/oidc/keys';
import type { OnClientRegistration } from '../src/oidc/registration';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

type TestUser = { email: string; sub: string };

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_NOT_IMPLEMENTED = 501;
const ISSUER = 'https://idp.example';

const buildApp = async ({
	initialAccessTokenHashes,
	onClientRegistration,
	registrationEnabled = true
}: {
	initialAccessTokenHashes?: string[];
	onClientRegistration?: OnClientRegistration;
	registrationEnabled?: boolean;
} = {}) =>
	auth<TestUser>({
		authSessionStore: createInMemoryAuthSessionStore<TestUser>(),
		oidc: {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientRegistrationTokenStore: registrationEnabled
				? createInMemoryClientRegistrationTokenStore()
				: undefined,
			clientStore: createInMemoryOAuthClientStore([]),
			getClaims: (user) => ({ email: user.email }),
			getUserId: (user) => user.sub,
			initialAccessTokenStore:
				initialAccessTokenHashes === undefined
					? undefined
					: createInMemoryInitialAccessTokenStore(
							initialAccessTokenHashes
						),
			issuer: ISSUER,
			onClientRegistration,
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey: await generateSigningKey()
		},
		providersConfiguration: {}
	});

const postJson = async (
	app: { handle: (req: Request) => Promise<Response> },
	url: string,
	body: Record<string, unknown>,
	headers: Record<string, string> = {}
) =>
	app.handle(
		new Request(url, {
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json', ...headers },
			method: 'POST'
		})
	);

describe('OIDC provider — Dynamic Client Registration (RFC 7591/7592)', () => {
	test('POST /register mints a client + registration_access_token', async () => {
		const app = await buildApp();
		const response = await postJson(
			app,
			'http://localhost/oauth2/register',
			{
				client_name: 'My App',
				redirect_uris: ['https://rp.test/cb'],
				scope: 'openid profile'
			}
		);
		expect(response.status).toBe(HTTP_OK);
		const body = await response.json();
		expect(body.client_id).toBeTruthy();
		expect(body.registration_access_token).toBeTruthy();
		expect(body.registration_client_uri).toBe(
			`${ISSUER}/oauth2/register/${body.client_id}`
		);
		expect(body.client_name).toBe('My App');
		expect(body.redirect_uris).toEqual(['https://rp.test/cb']);
	});

	test('rejects registration without redirect_uris', async () => {
		const app = await buildApp();
		const response = await postJson(
			app,
			'http://localhost/oauth2/register',
			{ client_name: 'No URIs' }
		);
		expect(response.status).toBe(HTTP_BAD_REQUEST);
	});

	test('respects an initialAccessTokenStore gate', async () => {
		const secret = 'token-letting-me-register';
		const app = await buildApp({
			initialAccessTokenHashes: [await hashToken(secret)]
		});
		// Without token → 401.
		const without = await postJson(
			app,
			'http://localhost/oauth2/register',
			{ redirect_uris: ['https://rp.test/cb'] }
		);
		expect(without.status).toBe(HTTP_UNAUTHORIZED);
		// With token → 200, AND the token is consumed (next call without fails).
		const withToken = await postJson(
			app,
			'http://localhost/oauth2/register',
			{ redirect_uris: ['https://rp.test/cb'] },
			{ authorization: `Bearer ${secret}` }
		);
		expect(withToken.status).toBe(HTTP_OK);
		const replay = await postJson(
			app,
			'http://localhost/oauth2/register',
			{ redirect_uris: ['https://rp.test/cb'] },
			{ authorization: `Bearer ${secret}` }
		);
		expect(replay.status).toBe(HTTP_UNAUTHORIZED);
	});

	test('onClientRegistration deny is surfaced as 403', async () => {
		const app = await buildApp({
			onClientRegistration: () => ({
				allow: false,
				denyReason: 'localhost redirect URIs are forbidden in this realm'
			})
		});
		const response = await postJson(
			app,
			'http://localhost/oauth2/register',
			{ redirect_uris: ['http://localhost/cb'] }
		);
		expect(response.status).toBe(HTTP_FORBIDDEN);
		const body = await response.json();
		expect(body.error).toBe('invalid_client_metadata');
		expect(body.error_description).toContain('localhost');
	});

	test('onClientRegistration transform clamps requested scopes', async () => {
		const app = await buildApp({
			onClientRegistration: () => ({
				allow: true,
				transform: { scopes: ['openid'] }
			})
		});
		const response = await postJson(
			app,
			'http://localhost/oauth2/register',
			{
				redirect_uris: ['https://rp.test/cb'],
				scope: 'openid profile admin'
			}
		);
		const body = await response.json();
		expect(body.scope).toBe('openid');
	});

	test('GET /register/{client_id} requires the registration_access_token', async () => {
		const app = await buildApp();
		const registered = await (
			await postJson(app, 'http://localhost/oauth2/register', {
				redirect_uris: ['https://rp.test/cb']
			})
		).json();

		const unauth = await app.handle(
			new Request(`http://localhost/oauth2/register/${registered.client_id}`)
		);
		expect(unauth.status).toBe(HTTP_UNAUTHORIZED);

		const authed = await app.handle(
			new Request(
				`http://localhost/oauth2/register/${registered.client_id}`,
				{
					headers: {
						authorization: `Bearer ${registered.registration_access_token}`
					}
				}
			)
		);
		expect(authed.status).toBe(HTTP_OK);
		const body = await authed.json();
		expect(body.client_id).toBe(registered.client_id);
	});

	test('PUT rotates the registration_access_token + updates metadata', async () => {
		const app = await buildApp();
		const registered = await (
			await postJson(app, 'http://localhost/oauth2/register', {
				client_name: 'Original',
				redirect_uris: ['https://rp.test/cb']
			})
		).json();

		const updated = await (
			await app.handle(
				new Request(
					`http://localhost/oauth2/register/${registered.client_id}`,
					{
						body: JSON.stringify({
							client_name: 'Updated',
							redirect_uris: ['https://rp.test/cb-new']
						}),
						headers: {
							authorization: `Bearer ${registered.registration_access_token}`,
							'content-type': 'application/json'
						},
						method: 'PUT'
					}
				)
			)
		).json();
		expect(updated.client_name).toBe('Updated');
		expect(updated.registration_access_token).toBeTruthy();
		expect(updated.registration_access_token).not.toBe(
			registered.registration_access_token
		);

		// Old token no longer works.
		const oldFails = await app.handle(
			new Request(
				`http://localhost/oauth2/register/${registered.client_id}`,
				{
					headers: {
						authorization: `Bearer ${registered.registration_access_token}`
					}
				}
			)
		);
		expect(oldFails.status).toBe(HTTP_UNAUTHORIZED);
	});

	test('DELETE removes the client + invalidates the reg token', async () => {
		const app = await buildApp();
		const registered = await (
			await postJson(app, 'http://localhost/oauth2/register', {
				redirect_uris: ['https://rp.test/cb']
			})
		).json();

		const deleted = await app.handle(
			new Request(
				`http://localhost/oauth2/register/${registered.client_id}`,
				{
					headers: {
						authorization: `Bearer ${registered.registration_access_token}`
					},
					method: 'DELETE'
				}
			)
		);
		expect(deleted.status).toBe(HTTP_NO_CONTENT);

		const gone = await app.handle(
			new Request(
				`http://localhost/oauth2/register/${registered.client_id}`,
				{
					headers: {
						authorization: `Bearer ${registered.registration_access_token}`
					}
				}
			)
		);
		expect(gone.status).toBe(HTTP_UNAUTHORIZED);
	});

	test('discovery advertises registration_endpoint when DCR is enabled', async () => {
		const app = await buildApp();
		const discovery = await (
			await app.handle(
				new Request('http://localhost/.well-known/openid-configuration')
			)
		).json();
		expect(discovery.registration_endpoint).toContain('/oauth2/register');
	});

	test('discovery omits registration_endpoint when DCR is OFF', async () => {
		const app = await buildApp({ registrationEnabled: false });
		const discovery = await (
			await app.handle(
				new Request('http://localhost/.well-known/openid-configuration')
			)
		).json();
		expect(discovery.registration_endpoint).toBeUndefined();
		const response = await postJson(
			app,
			'http://localhost/oauth2/register',
			{ redirect_uris: ['https://rp.test/cb'] }
		);
		expect(response.status).toBe(HTTP_NOT_IMPLEMENTED);
	});
});
