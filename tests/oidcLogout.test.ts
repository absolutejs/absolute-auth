import { beforeEach, describe, expect, test } from 'bun:test';
import { auth } from '../src/index';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryLogoutDeliveryStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { generateSigningKey, signJwt } from '../src/oidc/keys';
import type { LogoutDeliveryStore } from '../src/oidc/types';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import type { UserSessionId } from '../src/types';

type TestUser = { email: string; sub: string };

const HOUR_MS = 3_600_000;
const HTTP_FOUND = 302;
const HTTP_OK = 200;
const HTTP_INTERNAL_ERROR = 500;
const ISSUER = 'https://idp.example';
const RP_A = 'rp-a';
const RP_B = 'rp-b';
const RP_C_NO_BACKCHANNEL = 'rp-c';
const SESSION_ID: UserSessionId = '11111111-1111-4111-8111-111111111111';
const USER_SUB = 'user-alice';

type Captured = {
	body: string;
	headers: Record<string, string>;
	url: string;
};

const buildIdToken = async (
	signingKey: Awaited<ReturnType<typeof generateSigningKey>>,
	clientId: string
) =>
	signJwt(
		{
			aud: clientId,
			exp: Math.floor(Date.now() / 1000) + HOUR_MS,
			iat: Math.floor(Date.now() / 1000),
			iss: ISSUER,
			sub: USER_SUB
		},
		signingKey
	);

const buildApp = async ({
	captured = [],
	deliveryStore,
	fetchOk = true
}: {
	captured?: Captured[];
	deliveryStore?: LogoutDeliveryStore;
	fetchOk?: boolean;
} = {}) => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const signingKey = await generateSigningKey();
	const refreshTokenStore = createInMemoryOidcRefreshTokenStore();

	// Seed refresh tokens for rp-a, rp-b, and rp-c so all three are "active" RPs
	// for the user. Only rp-a + rp-b have backchannel URIs; rp-c is reachable for
	// id_token issuance but absent from the back-channel fan-out.
	const now = Date.now();
	await refreshTokenStore.saveToken({
		clientId: RP_A,
		createdAt: now,
		expiresAt: now + HOUR_MS,
		scopes: ['openid'],
		tokenHash: 'hash-a',
		userId: USER_SUB
	});
	await refreshTokenStore.saveToken({
		clientId: RP_B,
		createdAt: now,
		expiresAt: now + HOUR_MS,
		scopes: ['openid'],
		tokenHash: 'hash-b',
		userId: USER_SUB
	});
	await refreshTokenStore.saveToken({
		clientId: RP_C_NO_BACKCHANNEL,
		createdAt: now,
		expiresAt: now + HOUR_MS,
		scopes: ['openid'],
		tokenHash: 'hash-c',
		userId: USER_SUB
	});

	globalThis.fetch = (async (url: string, init: RequestInit) => ({
		ok: fetchOk,
		status: fetchOk ? HTTP_OK : HTTP_INTERNAL_ERROR
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal fetch stub
	})) as any;
	const recordingFetch = async (url: string, init: RequestInit) => {
		captured.push({
			body: String(init.body ?? ''),
			headers: init.headers as Record<string, string>,
			url
		});

		return new Response(null, {
			status: fetchOk ? HTTP_OK : HTTP_INTERNAL_ERROR
		});
	};
	globalThis.fetch = recordingFetch as unknown as typeof globalThis.fetch;

	const app = await auth<TestUser>({
		authSessionStore,
		oidc: {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([
				{
					backchannelLogoutUri: 'https://rp-a.test/backchannel',
					clientId: RP_A,
					name: 'RP A',
					postLogoutRedirectUris: ['https://rp-a.test/after-logout'],
					redirectUris: ['https://rp-a.test/callback'],
					scopes: ['openid']
				},
				{
					backchannelLogoutUri: 'https://rp-b.test/backchannel',
					clientId: RP_B,
					name: 'RP B',
					redirectUris: ['https://rp-b.test/callback'],
					scopes: ['openid']
				},
				{
					clientId: RP_C_NO_BACKCHANNEL,
					name: 'RP C',
					redirectUris: ['https://rp-c.test/callback'],
					scopes: ['openid']
				}
			]),
			getClaims: (user) => ({ email: user.email }),
			getUserId: (user) => user.sub,
			issuer: ISSUER,
			logoutDeliveryStore: deliveryStore,
			refreshTokenStore,
			signingKey
		},
		providersConfiguration: {}
	});
	await authSessionStore.setSession(SESSION_ID, {
		authenticatedAt: Date.now(),
		expiresAt: Date.now() + HOUR_MS,
		user: { email: 'alice@acme.test', sub: USER_SUB }
	});

	return { app, signingKey };
};

describe('OIDC end_session (RP-initiated logout)', () => {
	let captured: Captured[] = [];

	beforeEach(() => {
		captured = [];
	});

	test('discovery advertises end_session + backchannel logout support', async () => {
		const { app } = await buildApp({ captured });
		const discovery = await (
			await app.handle(
				new Request('http://localhost/.well-known/openid-configuration')
			)
		).json();
		expect(discovery.end_session_endpoint).toContain('/oauth2/end_session');
		expect(discovery.backchannel_logout_supported).toBe(true);
	});

	test('redirects to post_logout_redirect_uri with state when registered', async () => {
		const { app, signingKey } = await buildApp({ captured });
		const idToken = await buildIdToken(signingKey, RP_A);

		const params = new URLSearchParams({
			id_token_hint: idToken,
			post_logout_redirect_uri: 'https://rp-a.test/after-logout',
			state: 'xyz'
		});
		const response = await app.handle(
			new Request(
				`http://localhost/oauth2/end_session?${params.toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);

		expect(response.status).toBe(HTTP_FOUND);
		const location = response.headers.get('location') ?? '';
		expect(location).toContain('https://rp-a.test/after-logout');
		expect(location).toContain('state=xyz');
	});

	test('falls back to 200 when post_logout_redirect_uri is NOT registered', async () => {
		const { app, signingKey } = await buildApp({ captured });
		const idToken = await buildIdToken(signingKey, RP_A);

		const params = new URLSearchParams({
			id_token_hint: idToken,
			post_logout_redirect_uri: 'https://attacker.test/steal'
		});
		const response = await app.handle(
			new Request(
				`http://localhost/oauth2/end_session?${params.toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);

		expect(response.status).toBe(HTTP_OK);
	});

	test('fans out back-channel logout_token POSTs to RPs with backchannelLogoutUri, skipping the initiator', async () => {
		const { app, signingKey } = await buildApp({ captured });
		const idToken = await buildIdToken(signingKey, RP_A);

		const params = new URLSearchParams({
			id_token_hint: idToken,
			post_logout_redirect_uri: 'https://rp-a.test/after-logout'
		});
		await app.handle(
			new Request(
				`http://localhost/oauth2/end_session?${params.toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);

		// RP A is the initiator (skipped). RP B has backchannel + is targeted.
		// RP C has no backchannel URI → skipped despite an active token.
		expect(captured).toHaveLength(1);
		expect(captured[0]?.url).toBe('https://rp-b.test/backchannel');
		expect(captured[0]?.body).toContain('logout_token=');
		expect(captured[0]?.headers['content-type']).toBe(
			'application/x-www-form-urlencoded'
		);
	});

	test('persists permanent back-channel failures to the delivery store DLQ', async () => {
		const deliveryStore = createInMemoryLogoutDeliveryStore();
		const { app, signingKey } = await buildApp({
			captured,
			deliveryStore,
			fetchOk: false
		});
		const idToken = await buildIdToken(signingKey, RP_A);

		const params = new URLSearchParams({ id_token_hint: idToken });
		await app.handle(
			new Request(
				`http://localhost/oauth2/end_session?${params.toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);

		const failed = await deliveryStore.listFailed();
		expect(failed).toHaveLength(1);
		expect(failed[0]?.clientId).toBe(RP_B);
		expect(failed[0]?.endpointUrl).toBe('https://rp-b.test/backchannel');
		expect(failed[0]?.lastStatus).toBe(HTTP_INTERNAL_ERROR);
		expect(failed[0]?.logoutToken.split('.').length).toBe(3);
	});
});
