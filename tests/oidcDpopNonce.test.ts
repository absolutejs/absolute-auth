import { describe, expect, test } from 'bun:test';
import {
	extractDpopNonceClaim,
	mintDpopNonce,
	verifyDpopNonce
} from '../src/oidc/dpop';
import { generateSigningKey, signJwt, toPublicJwk } from '../src/oidc/keys';
import { auth } from '../src/index';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { hashToken } from '../src/crypto';
import type { UserSessionId } from '../src/types';

type TestUser = { email: string; sub: string };

const ISSUER = 'https://idp.example';
const REDIRECT_URI = 'https://rp.test/cb';
const SESSION_ID: UserSessionId = '11111111-1111-4111-8111-111111111111';
const VERIFIER = 'pkce-verifier-0123456789-abcdefghij-0123456789';
const HOUR_MS = 3_600_000;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;

const buildDpopProof = async ({
	htu,
	key,
	nonce
}: {
	htu: string;
	key: Awaited<ReturnType<typeof generateSigningKey>>;
	nonce?: string;
}) => {
	const payload: Record<string, unknown> = {
		htm: 'POST',
		htu,
		iat: Math.floor(Date.now() / 1000),
		jti: crypto.randomUUID()
	};
	if (nonce !== undefined) payload.nonce = nonce;
	// Build the DPoP header inline since signJwt doesn't expose the header shape directly.
	const encoder = new TextEncoder();
	const header = {
		alg: 'ES256',
		jwk: toPublicJwk(key),
		typ: 'dpop+jwt'
	};
	const headerSegment = Buffer.from(
		encoder.encode(JSON.stringify(header))
	).toString('base64url');
	const payloadSegment = Buffer.from(
		encoder.encode(JSON.stringify(payload))
	).toString('base64url');
	const cryptoKey = await crypto.subtle.importKey(
		'jwk',
		key.privateJwk,
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign(
		{ hash: 'SHA-256', name: 'ECDSA' },
		cryptoKey,
		encoder.encode(`${headerSegment}.${payloadSegment}`)
	);
	const signatureSegment = Buffer.from(new Uint8Array(signature)).toString(
		'base64url'
	);

	return `${headerSegment}.${payloadSegment}.${signatureSegment}`;
};

describe('DPoP nonces (RFC 9449 §8) — helpers', () => {
	test('verifies a freshly minted nonce', async () => {
		const secret = 'shhh';
		const nonce = await mintDpopNonce({ secret });
		expect(await verifyDpopNonce({ nonce, secret })).toBe(true);
	});

	test('rejects a nonce signed with a different secret', async () => {
		const nonce = await mintDpopNonce({ secret: 'one' });
		expect(await verifyDpopNonce({ nonce, secret: 'two' })).toBe(false);
	});

	test('extractDpopNonceClaim pulls nonce from a proof', async () => {
		const key = await generateSigningKey();
		const proof = await buildDpopProof({
			htu: 'https://idp.example/oauth2/token',
			key,
			nonce: 'abc'
		});
		expect(extractDpopNonceClaim(proof)).toBe('abc');
	});
});

describe('OIDC provider — DPoP nonce enforcement at /token', () => {
	const buildApp = async () => {
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
				dpopNonce: { secret: 'nonce-secret' },
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
			user: { email: 'alice@acme.test', sub: 'user-alice' }
		});

		return app;
	};

	const getCode = async (app: {
		handle: (req: Request) => Promise<Response>;
	}) => {
		const params = new URLSearchParams({
			client_id: 'rp',
			code_challenge: await hashToken(VERIFIER),
			code_challenge_method: 'S256',
			redirect_uri: REDIRECT_URI,
			response_type: 'code',
			scope: 'openid'
		});
		const response = await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${params.toString()}`,
				{
					headers: { cookie: `user_session_id=${SESSION_ID}` }
				}
			)
		);
		const location = response.headers.get('location') ?? '';

		return new URL(location).searchParams.get('code') ?? '';
	};

	test('first DPoP request without nonce → 401 + DPoP-Nonce header', async () => {
		const app = await buildApp();
		const code = await getCode(app);
		const dpopKey = await generateSigningKey();
		const proof = await buildDpopProof({
			htu: `${ISSUER}/oauth2/token`,
			key: dpopKey
		});

		const response = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					client_id: 'rp',
					code,
					code_verifier: VERIFIER,
					grant_type: 'authorization_code',
					redirect_uri: REDIRECT_URI
				}),
				headers: { dpop: proof },
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_UNAUTHORIZED);
		expect(response.headers.get('dpop-nonce')).toBeTruthy();
		expect(response.headers.get('www-authenticate')).toContain(
			'use_dpop_nonce'
		);
		expect((await response.json()).error).toBe('use_dpop_nonce');
	});

	test('retry with the issued nonce succeeds', async () => {
		const app = await buildApp();
		const code = await getCode(app);
		const dpopKey = await generateSigningKey();

		const initialProof = await buildDpopProof({
			htu: `${ISSUER}/oauth2/token`,
			key: dpopKey
		});
		const challenge = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					client_id: 'rp',
					code,
					code_verifier: VERIFIER,
					grant_type: 'authorization_code',
					redirect_uri: REDIRECT_URI
				}),
				headers: { dpop: initialProof },
				method: 'POST'
			})
		);
		const nonce = challenge.headers.get('dpop-nonce');
		expect(nonce).toBeTruthy();

		const retryProof = await buildDpopProof({
			htu: `${ISSUER}/oauth2/token`,
			key: dpopKey,
			nonce: nonce ?? ''
		});
		const retry = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: new URLSearchParams({
					client_id: 'rp',
					code,
					code_verifier: VERIFIER,
					grant_type: 'authorization_code',
					redirect_uri: REDIRECT_URI
				}),
				headers: { dpop: retryProof },
				method: 'POST'
			})
		);
		expect(retry.status).toBe(HTTP_OK);
		const tokens = await retry.json();
		expect(tokens.token_type).toBe('DPoP');
	});

	test('a non-DPoP request is unaffected by nonce enforcement', async () => {
		const app = await buildApp();
		const code = await getCode(app);
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
		expect(response.status).toBe(HTTP_OK);
	});
});
