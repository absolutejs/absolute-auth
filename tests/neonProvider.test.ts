import { describe, expect, test } from 'bun:test';
import { createOAuth2Client } from 'citra';
import { buildClientProviders } from '../src/providers/clients';
import {
	createNeonProviderConfiguration,
	neonProviderConfiguration
} from '../src/providers/neon';

const credentials = {
	clientId: 'neon-partner-test',
	clientSecret: 'test-only-secret',
	redirectUri: 'https://app.example.test/auth/neon/callback'
};

describe('Neon partner OAuth provider', () => {
	test('requires explicit management permissions and offline access', () => {
		const configuration = createNeonProviderConfiguration({
			credentials,
			scopes: []
		});
		expect(configuration.scope).toEqual(['openid']);
		expect(configuration.credentials).not.toBe(credentials);
		expect(neonProviderConfiguration.subject).toEqual(['sub']);
	});

	test('builds a PKCE authorization request through the Auth client registry', async () => {
		const configuration = createNeonProviderConfiguration({
			credentials,
			offlineAccess: true,
			scopes: [
				'urn:neoncloud:projects:read',
				'urn:neoncloud:projects:read',
				'urn:neoncloud:orgs:read'
			]
		});
		const registry = await buildClientProviders(
			{ neon: configuration },
			createOAuth2Client
		);
		const entry = registry.neon?.entries[''];
		if (!entry) throw new Error('Neon client missing');
		expect(entry.requiresPKCE).toBe(true);
		const url = await entry.providerInstance.createAuthorizationUrl({
			codeVerifier:
				'a-test-verifier-with-at-least-forty-three-characters',
			scope: configuration.scope,
			state: 'opaque-test-state'
		});
		expect(url.origin + url.pathname).toBe(
			'https://oauth2.neon.tech/oauth2/auth'
		);
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('client_id')).toBe(credentials.clientId);
		expect(url.searchParams.get('redirect_uri')).toBe(
			credentials.redirectUri
		);
		expect(url.searchParams.get('state')).toBe('opaque-test-state');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
		expect(url.searchParams.get('code_challenge')).toBeTruthy();
		expect(url.searchParams.get('scope')?.split(' ')).toEqual([
			'openid',
			'offline',
			'offline_access',
			'urn:neoncloud:projects:read',
			'urn:neoncloud:orgs:read'
		]);
		expect(url.toString()).not.toContain(credentials.clientSecret);
	});
});
