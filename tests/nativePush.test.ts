import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { pushRoutes } from '../src/nativePush';
import { generateSigningKey } from '../src/oidc/keys';
import { issueTokenSet, type OidcProviderConfig } from '../src/oidc/config';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';

type TestUser = { organizationId: string; sub: string };

const fixture = async ({
	registrationError,
	removalError
}: { registrationError?: Error; removalError?: Error } = {}) => {
	const signingKey = await generateSigningKey();
	const user: TestUser = { organizationId: 'tenant-server', sub: 'user-42' };
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
		clientId: 'absolutejs-native:com.example.app',
		config: oidc,
		scopes: ['openid', 'profile'],
		sub: user.sub
	});
	const registered: unknown[] = [];
	const removed: unknown[] = [];
	const app = new Elysia().use(
		pushRoutes<TestUser>({
			accessTokens: {
				oidc,
				getUser: (subject) => (subject === user.sub ? user : null)
			},
			config: {
				registrar: {
					registerInstallation: async (input) => {
						if (registrationError) throw registrationError;
						registered.push(input);

						return {
							installationId:
								input.installationId ?? 'server-installation-1'
						};
					},
					removeInstallation: async (input) => {
						if (removalError) throw removalError;
						removed.push(input);
					}
				},
				tenant: (principal) => principal.user.organizationId,
				topics: () => ['incidents', 'incidents']
			}
		})
	);
	const request = (
		method: 'DELETE' | 'POST',
		body: unknown,
		bearer = true,
		path = '/auth/push'
	) =>
		app.handle(
			new Request(`http://localhost${path}`, {
				body: JSON.stringify(body),
				headers: {
					...(bearer
						? { authorization: `Bearer ${tokens.access_token}` }
						: {}),
					'content-type': 'application/json'
				},
				method
			})
		);

	return { registered, removed, request };
};

describe('push registration', () => {
	test('derives user, tenant, and topics on the authenticated server', async () => {
		const harness = await fixture();
		const response = await harness.request('POST', {
			deviceId: 'installation-1',
			locale: 'en-US',
			platform: 'fcm',
			tenant: 'attacker-tenant',
			token: 'raw-provider-token',
			topics: ['admin']
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			installationId: 'server-installation-1',
			registered: true
		});
		expect(harness.registered).toEqual([
			{
				locale: 'en-US',
				platform: 'fcm',
				tenant: 'tenant-server',
				token: 'raw-provider-token',
				topics: ['incidents'],
				userId: 'user-42'
			}
		]);
	});

	test('accepts structured Web Push credentials on the canonical route', async () => {
		const harness = await fixture();
		const response = await harness.request('POST', {
			platform: 'webpush',
			subscription: {
				endpoint: 'https://push.example/subscription-1',
				keys: { auth: 'auth-key', p256dh: 'p256dh-key' }
			}
		});

		expect(response.status).toBe(200);
		expect(harness.registered).toEqual([
			{
				platform: 'webpush',
				subscription: {
					endpoint: 'https://push.example/subscription-1',
					keys: { auth: 'auth-key', p256dh: 'p256dh-key' }
				},
				tenant: 'tenant-server',
				topics: ['incidents'],
				userId: 'user-42'
			}
		]);
	});

	test('keeps the installed-client native route as an alias', async () => {
		const harness = await fixture();
		const response = await harness.request(
			'POST',
			{ platform: 'apns', token: 'native-token' },
			true,
			'/auth/mobile/push'
		);

		expect(response.status).toBe(200);
		expect(harness.registered).toEqual([
			expect.objectContaining({ platform: 'apns', token: 'native-token' })
		]);
	});

	test('removes only the authenticated installation identity', async () => {
		const harness = await fixture();
		const response = await harness.request('DELETE', {
			installationId: 'server-installation-1',
			tenant: 'attacker-tenant',
			userId: 'attacker'
		});
		expect(response.status).toBe(200);
		expect(harness.removed).toEqual([
			{
				installationId: 'server-installation-1',
				tenant: 'tenant-server',
				userId: 'user-42'
			}
		]);
	});

	test('rejects anonymous registration before the registrar runs', async () => {
		const harness = await fixture();
		const response = await harness.request(
			'POST',
			{
				installationId: 'server-installation-1',
				platform: 'apns',
				token: 'raw-provider-token'
			},
			false
		);
		expect(response.status).toBe(401);
		expect(harness.registered).toEqual([]);
	});

	test('returns a safe conflict when an installation belongs to another user', async () => {
		const ownershipError = new Error('internal ownership details');
		ownershipError.name = 'PushInstallationOwnershipError';
		const harness = await fixture({ registrationError: ownershipError });
		const response = await harness.request('POST', {
			installationId: 'prior-user-installation',
			platform: 'fcm',
			token: 'raw-provider-token'
		});

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			code: 'installation-ownership'
		});
	});

	test('returns the same safe conflict when removing another user installation', async () => {
		const ownershipError = new Error('internal ownership details');
		ownershipError.name = 'PushInstallationOwnershipError';
		const harness = await fixture({ removalError: ownershipError });
		const response = await harness.request('DELETE', {
			installationId: 'prior-user-installation'
		});

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			code: 'installation-ownership'
		});
	});
});
