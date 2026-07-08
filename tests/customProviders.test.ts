import { describe, expect, test } from 'bun:test';
import { createOAuth2Client, defineProvider } from 'citra';
import { buildClientProviders } from '../src/providers/clients';
import type { CustomProvidersConfiguration } from '../src/types';

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

describe('buildClientProviders with customProviders', () => {
	test('registers a custom provider alongside built-ins', async () => {
		const clientProviders = await buildClientProviders(
			{
				github: {
					credentials: {
						clientId: 'gh',
						clientSecret: 'gh-secret',
						redirectUri: 'https://app.example.test/auth/github/callback'
					}
				}
			},
			createOAuth2Client,
			customProviders
		);

		expect(Object.keys(clientProviders).sort()).toEqual([
			'acme',
			'github'
		]);
		const { acme } = clientProviders;
		expect(acme?.isSingleClient).toBe(true);
		expect(acme?.entries['']?.requiresPKCE).toBe(true);
		expect(acme?.entries['']?.scope).toEqual(['openid', 'profile']);
		expect(
			acme?.entries['']?.providerConfiguration.authorizationUrl
		).toBe('https://auth.acme.test/oauth2/authorize');

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
});
