import { beforeEach, describe, expect, test } from 'bun:test';
import { hashToken } from '../src/crypto';
import { auth } from '../src/index';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { generateSigningKey, signJwt, toPublicJwk } from '../src/oidc/keys';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import type { UserSessionId } from '../src/types';

type TestUser = { email: string; sub: string };

const HOUR_MS = 3_600_000;
const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const ISSUER = 'https://idp.example';
const REDIRECT_URI = 'https://rp.test/cb';
const SESSION_ID: UserSessionId = '11111111-1111-4111-8111-111111111111';
const VERIFIER = 'pkce-verifier-0123456789-abcdefghij-0123456789';

const buildRequestObject = async ({
	audience,
	clientId,
	codeChallenge,
	clientSigningKey,
	expSeconds
}: {
	audience: string;
	clientId: string;
	codeChallenge: string;
	clientSigningKey: Awaited<ReturnType<typeof generateSigningKey>>;
	expSeconds?: number;
}) =>
	signJwt(
		{
			aud: audience,
			client_id: clientId,
			code_challenge: codeChallenge,
			code_challenge_method: 'S256',
			exp: expSeconds ?? Math.floor(Date.now() / 1000) + 60,
			iat: Math.floor(Date.now() / 1000),
			iss: clientId,
			nonce: 'jar-nonce',
			redirect_uri: REDIRECT_URI,
			response_type: 'code',
			scope: 'openid profile',
			state: 'jar-state'
		},
		clientSigningKey
	);

const buildApp = async ({
	clientPublicJwk,
	requireSigned = false
}: {
	clientPublicJwk: JsonWebKey;
	requireSigned?: boolean;
}) => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const app = await auth<TestUser>({
		authSessionStore,
		oidc: {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([
				{
					clientId: 'rp-jar',
					jwks: [clientPublicJwk],
					name: 'RP with JWKS',
					redirectUris: [REDIRECT_URI],
					requireSignedRequestObject: requireSigned,
					scopes: ['openid', 'profile']
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
	await authSessionStore.setSession(SESSION_ID, {
		authenticatedAt: Date.now(),
		expiresAt: Date.now() + HOUR_MS,
		user: { email: 'alice@acme.test', sub: 'user-alice' }
	});

	return app;
};

describe('OIDC provider — JAR signed authorize requests (RFC 9101)', () => {
	let clientKey: Awaited<ReturnType<typeof generateSigningKey>>;
	let app: { handle: (req: Request) => Promise<Response> };
	let challenge: string;

	beforeEach(async () => {
		clientKey = await generateSigningKey();
		app = await buildApp({ clientPublicJwk: toPublicJwk(clientKey) });
		challenge = await hashToken(VERIFIER);
	});

	test('valid request= JWT replaces query params + issues a code', async () => {
		const requestJwt = await buildRequestObject({
			audience: ISSUER,
			clientId: 'rp-jar',
			clientSigningKey: clientKey,
			codeChallenge: challenge
		});
		const params = new URLSearchParams({
			client_id: 'rp-jar',
			request: requestJwt
		});

		const response = await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${params.toString()}`,
				{
					headers: { cookie: `user_session_id=${SESSION_ID}` }
				}
			)
		);
		expect(response.status).toBe(HTTP_FOUND);
		const location = response.headers.get('location') ?? '';
		expect(location).toContain(`${REDIRECT_URI}?code=`);
		expect(location).toContain('state=jar-state');
	});

	test('rejects a JWT signed by the wrong key', async () => {
		const attackerKey = await generateSigningKey();
		const requestJwt = await buildRequestObject({
			audience: ISSUER,
			clientId: 'rp-jar',
			clientSigningKey: attackerKey,
			codeChallenge: challenge
		});

		const response = await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${new URLSearchParams({
					client_id: 'rp-jar',
					request: requestJwt
				}).toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(response.status).toBe(HTTP_BAD_REQUEST);
		expect((await response.json()).error).toBe('invalid_request_object');
	});

	test('rejects a JWT with the wrong audience', async () => {
		const requestJwt = await buildRequestObject({
			audience: 'https://other-idp.example',
			clientId: 'rp-jar',
			clientSigningKey: clientKey,
			codeChallenge: challenge
		});

		const response = await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${new URLSearchParams({
					client_id: 'rp-jar',
					request: requestJwt
				}).toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(response.status).toBe(HTTP_BAD_REQUEST);
		expect((await response.json()).error).toBe('invalid_request_object');
	});

	test('rejects a JWT with iss !== client_id', async () => {
		const wrongIssJwt = await signJwt(
			{
				aud: ISSUER,
				client_id: 'rp-jar',
				code_challenge: challenge,
				code_challenge_method: 'S256',
				exp: Math.floor(Date.now() / 1000) + 60,
				iat: Math.floor(Date.now() / 1000),
				iss: 'not-rp-jar', // ← mismatched
				redirect_uri: REDIRECT_URI,
				response_type: 'code',
				scope: 'openid'
			},
			clientKey
		);

		const response = await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${new URLSearchParams({
					client_id: 'rp-jar',
					request: wrongIssJwt
				}).toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(response.status).toBe(HTTP_BAD_REQUEST);
		expect((await response.json()).error).toBe('invalid_request_object');
	});

	test('rejects an expired JWT', async () => {
		const expiredJwt = await buildRequestObject({
			audience: ISSUER,
			clientId: 'rp-jar',
			clientSigningKey: clientKey,
			codeChallenge: challenge,
			expSeconds: Math.floor(Date.now() / 1000) - 60
		});

		const response = await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${new URLSearchParams({
					client_id: 'rp-jar',
					request: expiredJwt
				}).toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(response.status).toBe(HTTP_BAD_REQUEST);
	});

	test('requireSignedRequestObject blocks plain query-string /authorize', async () => {
		const lockedApp = await buildApp({
			clientPublicJwk: toPublicJwk(clientKey),
			requireSigned: true
		});
		const params = new URLSearchParams({
			client_id: 'rp-jar',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			redirect_uri: REDIRECT_URI,
			response_type: 'code',
			scope: 'openid'
		});
		const response = await lockedApp.handle(
			new Request(
				`http://localhost/oauth2/authorize?${params.toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(response.status).toBe(HTTP_FOUND);
		const location = response.headers.get('location') ?? '';
		expect(location).toContain('error=invalid_request_object');
	});

	test('requireSignedRequestObject lets a valid JAR through', async () => {
		const lockedApp = await buildApp({
			clientPublicJwk: toPublicJwk(clientKey),
			requireSigned: true
		});
		const requestJwt = await buildRequestObject({
			audience: ISSUER,
			clientId: 'rp-jar',
			clientSigningKey: clientKey,
			codeChallenge: challenge
		});
		const response = await lockedApp.handle(
			new Request(
				`http://localhost/oauth2/authorize?${new URLSearchParams({
					client_id: 'rp-jar',
					request: requestJwt
				}).toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location') ?? '').toContain(
			`${REDIRECT_URI}?code=`
		);
	});

	test('discovery advertises JAR support', async () => {
		const discovery = await (
			await app.handle(
				new Request('http://localhost/.well-known/openid-configuration')
			)
		).json();
		expect(discovery.request_parameter_supported).toBe(true);
		expect(discovery.require_signed_request_object_supported).toBe(true);
		expect(discovery.request_object_signing_alg_values_supported).toContain(
			'ES256'
		);
	});
});
