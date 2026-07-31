import { describe, expect, test } from 'bun:test';
import { createOAuth2Client, defineProvider } from 'citra';
import { buildClientProviders } from '../src/providers/clients';
import { profile } from '../src/routes/profile';
import { refresh } from '../src/routes/refresh';
import { revoke } from '../src/routes/revoke';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import type { CustomProvidersConfiguration } from '../src/types';
import { resolveOAuthAuthorization } from '../src/utils';
import { TEST_SESSION_ID, createTestSessionData } from './setup';

const acmeProviderConfig = defineProvider({
	authorizationUrl: 'https://auth.acme.test/oauth2/authorize',
	isOIDC: true,
	isRefreshable: true,
	PKCEMethod: 'S256',
	profileRequest: {
		authIn: 'header',
		encoding: 'application/json',
		method: 'GET',
		url: 'https://auth.acme.test/oauth2/userinfo'
	},
	revocationRequest: {
		authIn: 'body',
		encoding: 'application/x-www-form-urlencoded',
		tokenParamName: 'token',
		url: 'https://auth.acme.test/oauth2/revoke'
	},
	scopeRequired: true,
	subject: ['sub'],
	subjectType: 'string',
	tokenRequest: {
		authIn: 'body',
		encoding: 'application/x-www-form-urlencoded',
		url: 'https://auth.acme.test/oauth2/token'
	}
});

const customProviders: CustomProvidersConfiguration = {
	acme: {
		credentials: {
			clientId: 'acme-app',
			clientSecret: 'shh',
			redirectUri: 'https://app.example.test/auth/acme/callback'
		},
		providerConfig: acmeProviderConfig,
		scope: ['openid', 'profile']
	}
};

const customProviderCookies = [
	`user_session_id=${TEST_SESSION_ID}`,
	'auth_provider=acme',
	'auth_client='
].join('; ');

describe('buildClientProviders with customProviders', () => {
	test('registers a custom provider alongside built-ins', async () => {
		const clientProviders = await buildClientProviders(
			{
				github: {
					credentials: {
						clientId: 'gh',
						clientSecret: 'gh-secret',
						redirectUri:
							'https://app.example.test/auth/github/callback'
					}
				}
			},
			createOAuth2Client,
			customProviders
		);

		expect(Object.keys(clientProviders).sort()).toEqual(['acme', 'github']);
		const { acme } = clientProviders;
		expect(acme?.isSingleClient).toBe(true);
		expect(acme?.entries['']?.requiresPKCE).toBe(true);
		expect(acme?.entries['']?.scope).toEqual(['openid', 'profile']);
		expect(acme?.entries['']?.providerConfiguration.authorizationUrl).toBe(
			'https://auth.acme.test/oauth2/authorize'
		);

		const { github } = clientProviders;
		expect(github?.entries['']?.requiresPKCE).toBe(false);
		expect(github?.entries['']?.providerConfiguration.subject).toEqual([
			'id'
		]);
	});

	test('custom provider authorization URL builds from its config', async () => {
		const clientProviders = await buildClientProviders(
			{},
			createOAuth2Client,
			customProviders
		);
		const instance = clientProviders['acme']?.entries['']?.providerInstance;
		if (!instance) throw new Error('acme instance missing');
		const url = await instance.createAuthorizationUrl({
			codeVerifier: 'verifier-verifier-verifier-verifier-12345678',
			scope: ['openid'],
			state: 'st'
		});

		expect(url.origin).toBe('https://auth.acme.test');
		expect(url.searchParams.get('client_id')).toBe('acme-app');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
	});

	test('rejects a custom key that collides with a built-in provider', async () => {
		const acmeConfig = customProviders['acme'];
		if (!acmeConfig) throw new Error('acme config missing');
		await expect(
			buildClientProviders({}, createOAuth2Client, {
				google: acmeConfig
			})
		).rejects.toThrow('collides with a built-in provider');
	});

	test('supports custom provider profile, refresh, and revocation routes', async () => {
		const clientProviders = await buildClientProviders(
			{},
			createOAuth2Client,
			customProviders
		);
		const providerInstance =
			clientProviders['acme']?.entries['']?.providerInstance;
		if (!providerInstance) throw new Error('acme instance missing');

		let revokedInput: string | number | undefined;
		Object.assign(providerInstance, {
			fetchUserProfile: async (accessToken: string) => ({
				accessToken,
				sub: 'acme-user'
			}),
			refreshAccessToken: async (refreshToken: string) => ({
				access_token: `${refreshToken}-rotated`,
				refresh_token: 'next-refresh-token'
			}),
			revokeToken: async (input: string | number) => {
				revokedInput = input;
			}
		});

		const authSessionStore = createInMemoryAuthSessionStore<{
			sub: string;
		}>();
		await authSessionStore.setSession(
			TEST_SESSION_ID,
			createTestSessionData({ refreshToken: 'refresh-token' })
		);

		const profileApp = profile({
			authSessionStore,
			clientProviders,
			onProfileError: undefined,
			onProfileSuccess: undefined
		});
		const profileResponse = await profileApp.handle(
			new Request('http://localhost/oauth2/profile', {
				headers: { cookie: customProviderCookies }
			})
		);
		expect(profileResponse.status).toBe(200);
		expect(await profileResponse.json()).toEqual({
			accessToken: 'test-access-token',
			sub: 'acme-user'
		});

		const refreshApp = refresh({
			authSessionStore,
			clientProviders,
			onRefreshError: undefined,
			onRefreshSuccess: undefined
		});
		const refreshResponse = await refreshApp.handle(
			new Request('http://localhost/oauth2/tokens', {
				headers: { cookie: customProviderCookies },
				method: 'POST'
			})
		);
		expect(refreshResponse.status).toBe(204);
		expect(
			await authSessionStore.getSession(TEST_SESSION_ID)
		).toMatchObject({
			accessToken: 'refresh-token-rotated',
			refreshToken: 'next-refresh-token'
		});

		const revokeApp = revoke({
			authSessionStore,
			clientProviders,
			onRevocationError: undefined,
			onRevocationSuccess: undefined
		});
		const revokeResponse = await revokeApp.handle(
			new Request('http://localhost/oauth2/revocation', {
				headers: { cookie: customProviderCookies },
				method: 'POST'
			})
		);
		expect(revokeResponse.status).toBe(204);
		expect(revokedInput).toBe('refresh-token-rotated');
	});

	test('returns 501 for a custom provider without a profile capability', async () => {
		const providerConfig = defineProvider({
			authorizationUrl: 'https://auth.acme.test/oauth2/authorize',
			isOIDC: false,
			scopeRequired: false,
			subject: ['sub'],
			subjectType: 'string',
			tokenRequest: {
				authIn: 'body',
				encoding: 'application/x-www-form-urlencoded',
				url: 'https://auth.acme.test/oauth2/token'
			}
		});
		const clientProviders = await buildClientProviders(
			{},
			createOAuth2Client,
			{
				acme: {
					credentials: {
						clientId: 'acme-app',
						clientSecret: 'shh',
						redirectUri:
							'https://app.example.test/auth/acme/callback'
					},
					providerConfig
				}
			}
		);
		const app = profile({
			clientProviders,
			onProfileError: undefined,
			onProfileSuccess: undefined
		});
		const response = await app.handle(
			new Request('http://localhost/oauth2/profile', {
				headers: { cookie: customProviderCookies }
			})
		);

		expect(response.status).toBe(501);
		expect(await response.text()).toBe(
			'Provider does not expose a profile endpoint'
		);
		const providerInstance =
			clientProviders['acme']?.entries['']?.providerInstance;
		if (!providerInstance) throw new Error('acme instance missing');
		await expect(
			resolveOAuthAuthorization({
				authProvider: 'acme',
				providerConfiguration: providerConfig,
				providerInstance,
				tokenResponse: { access_token: 'access-token' }
			})
		).rejects.toThrow(
			'Provider "acme" returned no identity and has no profile endpoint'
		);
	});

	test('revokes Withings with the numeric OAuth subject', async () => {
		const clientProviders = await buildClientProviders(
			{
				withings: {
					credentials: {
						clientId: 'withings-app',
						clientSecret: 'withings-secret',
						redirectUri:
							'https://app.example.test/auth/withings/callback'
					}
				}
			},
			createOAuth2Client
		);
		const providerInstance =
			clientProviders['withings']?.entries['']?.providerInstance;
		if (!providerInstance) throw new Error('withings instance missing');
		await expect(
			resolveOAuthAuthorization({
				authProvider: 'withings',
				providerInstance,
				tokenResponse: {
					body: {
						access_token: 'withings-access-token',
						userid: 142857
					}
				}
			})
		).resolves.toMatchObject({ oauthSubject: 142857 });

		let revokedInput: string | number | undefined;
		Object.assign(providerInstance, {
			revokeToken: async (input: string | number) => {
				revokedInput = input;
			}
		});
		const authSessionStore = createInMemoryAuthSessionStore<{
			sub: string;
		}>();
		await authSessionStore.setSession(
			TEST_SESSION_ID,
			createTestSessionData({
				oauthSubject: 142857,
				refreshToken: 'withings-refresh-token'
			})
		);
		const app = revoke({
			authSessionStore,
			clientProviders,
			onRevocationError: undefined,
			onRevocationSuccess: undefined
		});
		const response = await app.handle(
			new Request('http://localhost/oauth2/revocation', {
				headers: {
					cookie: customProviderCookies.replace('acme', 'withings')
				},
				method: 'POST'
			})
		);

		expect(response.status).toBe(204);
		expect(revokedInput).toBe(142857);
	});
});
