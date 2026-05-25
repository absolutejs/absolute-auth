import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { encodeBase64 } from 'citra';
import { auth } from '../src/index';
import { createInMemorySsoConnectionStore } from '../src/sso/inMemorySsoConnectionStore';
import type { SsoIdentity } from '../src/sso/config';
import type { OidcConnection } from '../src/sso/types';

type TestUser = {
	email: string;
	sub: string;
};

const HTTP_FOUND = 302;
const HTTP_NOT_FOUND = 404;
const MS_PER_SECOND = 1000;
const ONE_HOUR_SECONDS = 3600;
const RSA_MODULUS_LENGTH = 2048;

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

const toBase64Url = (input: string | Uint8Array) =>
	encodeBase64(input)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');

const rsaKeyPair = await crypto.subtle.generateKey(
	{
		hash: 'SHA-256',
		modulusLength: RSA_MODULUS_LENGTH,
		name: 'RSASSA-PKCS1-v1_5',
		publicExponent: new Uint8Array([1, 0, 1])
	},
	true,
	['sign', 'verify']
);
const publicJwk: JsonWebKey & { kid?: string } = await crypto.subtle.exportKey(
	'jwk',
	rsaKeyPair.publicKey
);
publicJwk.kid = 'rsa-test';

const buildIdToken = async (nonce: string) => {
	const nowSeconds = Math.floor(Date.now() / MS_PER_SECOND);
	const header: Record<string, string> = {
		alg: 'RS256',
		kid: 'rsa-test',
		typ: 'JWT'
	};
	const payload: Record<string, unknown> = {
		aud: CLIENT_ID,
		email: 'sam@acme.test',
		exp: nowSeconds + ONE_HOUR_SECONDS,
		iat: nowSeconds,
		iss: ISSUER,
		nonce,
		sub: 'oidc-user-1'
	};
	const signingInput = `${toBase64Url(JSON.stringify(header))}.${toBase64Url(
		JSON.stringify(payload)
	)}`;
	const signature = await crypto.subtle.sign(
		{ name: 'RSASSA-PKCS1-v1_5' },
		rsaKeyPair.privateKey,
		new TextEncoder().encode(signingInput)
	);

	return `${signingInput}.${toBase64Url(new Uint8Array(signature))}`;
};

let pendingIdToken = '';
const originalFetch = globalThis.fetch;

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
	if (url === JWKS_URI) {
		return Promise.resolve(jsonResponse({ keys: [publicJwk] }));
	}
	if (url === TOKEN_ENDPOINT) {
		return Promise.resolve(
			jsonResponse({
				access_token: 'access-token',
				id_token: pendingIdToken,
				token_type: 'Bearer'
			})
		);
	}

	return Promise.reject(new Error(`unexpected fetch: ${url}`));
};

const cookieValue = (setCookies: string[], name: string) => {
	const entry = setCookies.find((cookie) => cookie.startsWith(`${name}=`));
	if (entry === undefined) return '';

	return decodeURIComponent(entry.slice(name.length + 1).split(';')[0] ?? '');
};

let captured: SsoIdentity | undefined;

const resolveUser = (identity: SsoIdentity): TestUser => ({
	email: identity.email ?? '',
	sub: identity.sub
});

const captureUser = (identity: SsoIdentity) => {
	captured = identity;

	return resolveUser(identity);
};

const orgByDomain = (domain: string) =>
	domain === 'acme.test' ? 'acme' : undefined;

describe('OIDC SSO routes', () => {
	beforeEach(() => {
		globalThis.fetch = mockFetch;
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test('authorize 404s for an organization with no OIDC connection', async () => {
		const ssoConnectionStore = createInMemorySsoConnectionStore();
		const app = await auth<TestUser>({
			providersConfiguration: {},
			sso: { getSsoUser: resolveUser, ssoConnectionStore }
		});

		const response = await app.handle(
			new Request('http://localhost/sso/oidc/unknown/authorize')
		);

		expect(response.status).toBe(HTTP_NOT_FOUND);
	});

	test('completes the authorize -> callback flow and creates a session', async () => {
		captured = undefined;
		const ssoConnectionStore = createInMemorySsoConnectionStore();
		await ssoConnectionStore.saveConnection(oidcConnection);
		const app = await auth<TestUser>({
			providersConfiguration: {},
			sso: { getSsoUser: captureUser, ssoConnectionStore }
		});

		const authorizeResponse = await app.handle(
			new Request('http://localhost/sso/oidc/acme/authorize', {
				redirect: 'manual'
			})
		);
		expect(authorizeResponse.status).toBe(HTTP_FOUND);
		const setCookies = authorizeResponse.headers.getSetCookie();
		const state = cookieValue(setCookies, 'sso_state');
		const verifier = cookieValue(setCookies, 'sso_verifier');
		const nonce = cookieValue(setCookies, 'sso_nonce');
		const organization = cookieValue(setCookies, 'sso_organization');
		expect(state.length).toBeGreaterThan(0);

		pendingIdToken = await buildIdToken(nonce);
		const callbackResponse = await app.handle(
			new Request(
				`http://localhost/sso/oidc/acme/callback?code=auth-code&state=${state}`,
				{
					headers: {
						cookie: `sso_state=${state}; sso_verifier=${verifier}; sso_nonce=${nonce}; sso_organization=${organization}`
					},
					redirect: 'manual'
				}
			)
		);

		expect(callbackResponse.status).toBe(HTTP_FOUND);
		expect(callbackResponse.headers.getSetCookie().join(';')).toContain(
			'user_session_id'
		);
		expect(captured?.protocol).toBe('oidc');
		expect(captured?.sub).toBe('oidc-user-1');
		expect(captured?.email).toBe('sam@acme.test');
	});

	test('home-realm discovery routes an email domain to its org', async () => {
		const ssoConnectionStore = createInMemorySsoConnectionStore();
		await ssoConnectionStore.saveConnection(oidcConnection);
		const app = await auth<TestUser>({
			providersConfiguration: {},
			sso: {
				getOrganizationByEmailDomain: orgByDomain,
				getSsoUser: resolveUser,
				ssoConnectionStore
			}
		});

		const matched = await app.handle(
			new Request('http://localhost/sso/authorize?email=sam@acme.test', {
				redirect: 'manual'
			})
		);
		expect(matched.status).toBe(HTTP_FOUND);
		expect(matched.headers.get('location')).toBe(
			'/sso/oidc/acme/authorize'
		);

		const unknown = await app.handle(
			new Request('http://localhost/sso/authorize?email=sam@other.test')
		);
		expect(unknown.status).toBe(HTTP_NOT_FOUND);
	});
});
