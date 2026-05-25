import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { auth } from '../src/index';
import { createInMemorySsoConnectionStore } from '../src/sso/inMemorySsoConnectionStore';
import type { SsoIdentity } from '../src/sso/config';
import type { OidcConnection } from '../src/sso/types';

type TestUser = {
	email: string;
	sub: string;
};

const ISSUER = 'https://idp.test';
const CLIENT_ID = 'client-abc';
const AUTH_ENDPOINT = `${ISSUER}/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/token`;
const JWKS_URI = `${ISSUER}/jwks`;

const oidcConnection: OidcConnection = {
	config: {
		clientId: CLIENT_ID,
		clientSecret: 'shh',
		issuer: ISSUER,
		redirectUri: 'https://app.test/sso/oidc/acme/callback',
		scopes: ['openid', 'email', 'profile']
	},
	connectionId: 'conn-acme',
	createdAt: 1,
	enabled: true,
	organizationId: 'acme',
	type: 'oidc',
	updatedAt: 1
};

const discoveryDocument: Record<string, string> = {
	authorization_endpoint: AUTH_ENDPOINT,
	issuer: ISSUER,
	jwks_uri: JWKS_URI,
	token_endpoint: TOKEN_ENDPOINT,
	userinfo_endpoint: `${ISSUER}/userinfo`
};

const originalFetch = globalThis.fetch;

const HTTP_FOUND = 302;
const HTTP_NOT_FOUND = 404;

const jsonResponse = (body: unknown) =>
	new Response(JSON.stringify(body), {
		headers: { 'content-type': 'application/json' }
	});

const requestUrl = (input: string | URL | Request) => {
	if (typeof input === 'string') return input;
	if (input instanceof URL) return input.href;

	return input.url;
};

const mockFetch: typeof globalThis.fetch = (input) => {
	const url = requestUrl(input);
	if (url.includes('/.well-known/openid-configuration')) {
		return Promise.resolve(jsonResponse(discoveryDocument));
	}

	return Promise.reject(new Error(`unexpected fetch: ${url}`));
};

const buildAuth = (getSsoUser: (identity: SsoIdentity) => TestUser) => {
	const ssoConnectionStore = createInMemorySsoConnectionStore();

	return {
		app: auth<TestUser>({
			providersConfiguration: {},
			sso: { getSsoUser, ssoConnectionStore }
		}),
		ssoConnectionStore
	};
};

const resolveUser = (identity: SsoIdentity): TestUser => ({
	email: identity.email ?? '',
	sub: identity.sub
});

describe('OIDC SSO routes', () => {
	beforeEach(() => {
		globalThis.fetch = mockFetch;
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test('authorize 404s for an organization with no OIDC connection', async () => {
		const { app } = buildAuth(resolveUser);

		const response = await (
			await app
		).handle(new Request('http://localhost/sso/oidc/unknown/authorize'));

		expect(response.status).toBe(HTTP_NOT_FOUND);
	});

	test('authorize redirects to the IdP with PKCE + state + nonce', async () => {
		const { app, ssoConnectionStore } = buildAuth(resolveUser);
		await ssoConnectionStore.saveConnection(oidcConnection);

		const response = await (
			await app
		).handle(
			new Request('http://localhost/sso/oidc/acme/authorize', {
				redirect: 'manual'
			})
		);

		expect(response.status).toBe(HTTP_FOUND);
		const location = response.headers.get('location') ?? '';
		const redirectUrl = new URL(location);
		expect(`${redirectUrl.origin}${redirectUrl.pathname}`).toBe(
			AUTH_ENDPOINT
		);
		expect(redirectUrl.searchParams.get('client_id')).toBe(CLIENT_ID);
		expect(redirectUrl.searchParams.get('code_challenge_method')).toBe(
			'S256'
		);
		expect(redirectUrl.searchParams.get('code_challenge')).not.toBeNull();
		expect(redirectUrl.searchParams.get('state')).not.toBeNull();
		expect(redirectUrl.searchParams.get('nonce')).not.toBeNull();

		const setCookies = response.headers.getSetCookie();
		const cookieNames = setCookies.join(';');
		expect(cookieNames).toContain('sso_state');
		expect(cookieNames).toContain('sso_verifier');
		expect(cookieNames).toContain('sso_nonce');
	});
});
