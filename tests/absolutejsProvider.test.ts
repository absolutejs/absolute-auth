import { describe, expect, test } from 'bun:test';
import { createOAuth2Client } from 'citra';
import { manifest } from '../src/manifest';
import { providersFromEnv } from '../src/providersFromEnv';

/**
 * An app built on AbsoluteJS should be able to offer "Sign in with AbsoluteJS"
 * the same way it offers Google -- by naming the provider and setting two
 * environment variables. That means the control plane has to be a first-class
 * provider here, not something each app wires up by hand.
 */
describe('absolutejs as a configured provider', () => {
	test('resolves credentials from env by the standard convention', () => {
		const configured = providersFromEnv(
			{ absolutejs: { scope: ['openid'] } },
			{
				ABSOLUTEJS_CLIENT_ID: 'docs-client',
				ABSOLUTEJS_CLIENT_SECRET: 'docs-secret'
			}
		);

		expect(configured.absolutejs).toEqual({
			credentials: {
				clientId: 'docs-client',
				clientSecret: 'docs-secret'
			},
			scope: ['openid']
		});
	});

	test('declares the env keys and a place to create the client', () => {
		// Without these the no-code path cannot prompt for the credentials, so
		// the provider would be selectable but never configurable.
		const keys = manifest.requires.env?.map((entry) => entry.key) ?? [];

		expect(keys).toContain('ABSOLUTEJS_CLIENT_ID');
		expect(keys).toContain('ABSOLUTEJS_CLIENT_SECRET');
		expect(
			manifest.requires.env?.find((entry) => entry.key === 'ABSOLUTEJS_CLIENT_ID')
				?.docsUrl
		).toBe('https://absolutejs.ai/dashboard');
	});

	test('builds a client aimed at the control plane OIDC surface', async () => {
		const client = await createOAuth2Client('absolutejs', {
			clientId: 'docs-client',
			clientSecret: 'docs-secret',
			redirectUri: 'https://absolutejs.com/auth/absolutejs/callback'
		});
		const url = await client.createAuthorizationUrl({
			codeVerifier: 'verifier',
			scope: ['openid'],
			state: 'state'
		});

		expect(url.origin + url.pathname).toBe(
			'https://absolutejs.ai/oauth2/authorize'
		);
	});
});
