import { describe, expect, test } from 'bun:test';
import {
	parseAbsoluteNativeAuthClients,
	withAbsoluteNativeAuthClients
} from '../src/oidc/nativeClients';
import { createInMemoryOAuthClientStore } from '../src/oidc/inMemoryStores';

const nativeClient = {
	clientId: 'absolutejs-native:com.example.app',
	issuer: 'https://example.com',
	name: 'Example native app',
	redirectUri: 'com.example.app://auth/callback',
	scopes: ['openid', 'profile']
};

describe('AbsoluteJS native OAuth client provisioning', () => {
	test('strictly parses the deployment declaration', () => {
		expect(
			parseAbsoluteNativeAuthClients(JSON.stringify([nativeClient]))
		).toEqual([nativeClient]);
		expect(() => parseAbsoluteNativeAuthClients('{')).toThrow(
			'must contain JSON'
		);
		expect(() =>
			parseAbsoluteNativeAuthClients(
				JSON.stringify([{ ...nativeClient, scopes: [] }])
			)
		).toThrow('scopes');
	});

	test('adds only clients for the configured issuer', async () => {
		const store = withAbsoluteNativeAuthClients(
			createInMemoryOAuthClientStore([]),
			'https://example.com',
			[
				nativeClient,
				{
					...nativeClient,
					clientId: 'other',
					issuer: 'https://other.example.com'
				}
			]
		);
		expect(await store.findClient(nativeClient.clientId)).toEqual({
			clientId: nativeClient.clientId,
			name: nativeClient.name,
			redirectUris: [nativeClient.redirectUri],
			scopes: nativeClient.scopes
		});
		expect(await store.findClient('other')).toBeUndefined();
	});

	test('keeps an explicitly configured client authoritative', async () => {
		const configured = {
			clientId: nativeClient.clientId,
			name: 'Configured',
			redirectUris: ['https://example.com/callback'],
			scopes: ['openid']
		};
		const store = withAbsoluteNativeAuthClients(
			createInMemoryOAuthClientStore([configured]),
			'https://example.com',
			[nativeClient]
		);
		expect(await store.findClient(nativeClient.clientId)).toEqual(configured);
	});
});
