import { beforeEach, describe, expect, test } from 'bun:test';
import { hashToken } from '../src/crypto';
import { auth } from '../src/index';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { generateSigningKey, verifyJwt } from '../src/oidc/keys';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import type { UserSessionId } from '../src/types';

type TestUser = { acr?: string; email: string; sub: string };

const ISSUER = 'https://idp.example';
const REDIRECT_URI = 'https://rp.test/cb';
const SESSION_ID: UserSessionId = '11111111-1111-4111-8111-111111111111';
const VERIFIER = 'pkce-verifier-0123456789-abcdefghij-0123456789';
const HOUR_MS = 3_600_000;
const HTTP_OK = 200;
const HTTP_FOUND = 302;

const ACR_PWD = 'urn:absolute:pwd';
const ACR_MFA = 'urn:absolute:mfa';

const buildApp = async (userAcr: string) => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const app = await auth<TestUser>({
		authSessionStore,
		oidc: {
			acrValuesSupported: [ACR_PWD, ACR_MFA],
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([
				{
					clientId: 'rp',
					name: 'RP',
					redirectUris: [REDIRECT_URI],
					scopes: ['openid']
				}
			]),
			getAcr: ({ user }) => user.acr,
			getClaims: (user) => ({ email: user.email }),
			getUserId: (user) => user.sub,
			issuer: ISSUER,
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey: await generateSigningKey()
		},
		providersConfiguration: {}
	});
	await authSessionStore.setSession(SESSION_ID, {
		authenticatedAt: Date.now(),
		expiresAt: Date.now() + HOUR_MS,
		user: { acr: userAcr, email: 'alice@acme.test', sub: 'user-alice' }
	});

	return app;
};

const authorize = async (
	app: { handle: (req: Request) => Promise<Response> },
	acrValues?: string
) => {
	const params = new URLSearchParams({
		client_id: 'rp',
		code_challenge: await hashToken(VERIFIER),
		code_challenge_method: 'S256',
		redirect_uri: REDIRECT_URI,
		response_type: 'code',
		scope: 'openid'
	});
	if (acrValues !== undefined) params.set('acr_values', acrValues);

	return app.handle(
		new Request(`http://localhost/oauth2/authorize?${params.toString()}`, {
			headers: { cookie: `user_session_id=${SESSION_ID}` }
		})
	);
};

const codeFrom = (response: Response) =>
	new URL(response.headers.get('location') ?? '').searchParams.get('code') ??
	'';

const tokenExchange = (
	app: { handle: (req: Request) => Promise<Response> },
	code: string
) =>
	app.handle(
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

describe('OIDC provider — RFC 9470 acr_values', () => {
	test('discovery advertises acr_values_supported', async () => {
		const app = await buildApp(ACR_PWD);
		const discovery = await (
			await app.handle(
				new Request('http://localhost/.well-known/openid-configuration')
			)
		).json();
		expect(discovery.acr_values_supported).toEqual([ACR_PWD, ACR_MFA]);
	});

	test('id_token + access_token carry the user`s acr when the consumer hook returns one', async () => {
		const app = await buildApp(ACR_PWD);
		const redirect = await authorize(app);
		expect(redirect.status).toBe(HTTP_FOUND);
		const tokens = await (
			await tokenExchange(app, codeFrom(redirect))
		).json();

		const jwks = await (
			await app.handle(new Request('http://localhost/oauth2/jwks'))
		).json();
		const idToken = await verifyJwt(tokens.id_token, jwks.keys[0]);
		const accessToken = await verifyJwt(tokens.access_token, jwks.keys[0]);

		expect(idToken?.payload.acr).toBe(ACR_PWD);
		expect(accessToken?.payload.acr).toBe(ACR_PWD);
	});

	test('matching acr_values request succeeds + emits the matched acr', async () => {
		const app = await buildApp(ACR_MFA);
		const redirect = await authorize(app, ACR_MFA);
		expect(redirect.status).toBe(HTTP_FOUND);
		const tokens = await (
			await tokenExchange(app, codeFrom(redirect))
		).json();
		const jwks = await (
			await app.handle(new Request('http://localhost/oauth2/jwks'))
		).json();
		const idToken = await verifyJwt(tokens.id_token, jwks.keys[0]);
		expect(idToken?.payload.acr).toBe(ACR_MFA);
	});

	test('mismatched acr_values redirects with insufficient_user_authentication', async () => {
		// User only has pwd, RP asks for mfa.
		const app = await buildApp(ACR_PWD);
		const redirect = await authorize(app, ACR_MFA);
		expect(redirect.status).toBe(HTTP_FOUND);
		const location = redirect.headers.get('location') ?? '';
		expect(location).toContain(REDIRECT_URI);
		expect(location).toContain('error=insufficient_user_authentication');
	});

	test('refresh-token grant preserves the original acr', async () => {
		const app = await buildApp(ACR_MFA);
		const tokens = await (
			await tokenExchange(app, codeFrom(await authorize(app, ACR_MFA)))
		).json();

		const refreshed = await (
			await app.handle(
				new Request('http://localhost/oauth2/token', {
					body: new URLSearchParams({
						client_id: 'rp',
						grant_type: 'refresh_token',
						refresh_token: tokens.refresh_token
					}),
					method: 'POST'
				})
			)
		).json();
		const jwks = await (
			await app.handle(new Request('http://localhost/oauth2/jwks'))
		).json();
		const idToken = await verifyJwt(refreshed.id_token, jwks.keys[0]);
		expect(idToken?.payload.acr).toBe(ACR_MFA);
	});

	test('without acrValuesSupported, discovery omits the field', async () => {
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
						scopes: ['openid']
					}
				]),
				getClaims: (user) => ({ email: user.email }),
				getUserId: (user) => user.sub,
				issuer: ISSUER,
				refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
				signingKey: await generateSigningKey()
			},
			providersConfiguration: {}
		});
		const discovery = await (
			await app.handle(
				new Request('http://localhost/.well-known/openid-configuration')
			)
		).json();
		expect(discovery.acr_values_supported).toBeUndefined();
	});
});
