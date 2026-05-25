import { describe, expect, test } from 'bun:test';
import { createInMemorySsoConnectionStore } from '../src/sso/inMemorySsoConnectionStore';
import type { OidcConnection, SamlConnection } from '../src/sso/types';

const oidcConnection = (
	overrides: Partial<OidcConnection> = {}
): OidcConnection => ({
	config: {
		clientId: 'client-1',
		clientSecret: 'secret-1',
		issuer: 'https://idp.example.com',
		redirectUri: 'https://app.example.com/sso/oidc/org-1/callback',
		scopes: ['openid', 'email', 'profile']
	},
	connectionId: 'conn-oidc-1',
	createdAt: 1000,
	enabled: true,
	organizationId: 'org-1',
	type: 'oidc',
	updatedAt: 1000,
	...overrides
});

const samlConnection = (
	overrides: Partial<SamlConnection> = {}
): SamlConnection => ({
	config: {
		idpEntityId: 'urn:idp',
		idpSsoUrl: 'https://idp.example.com/sso',
		idpX509Cert: 'CERT'
	},
	connectionId: 'conn-saml-1',
	createdAt: 2000,
	enabled: true,
	organizationId: 'org-1',
	type: 'saml',
	updatedAt: 2000,
	...overrides
});

describe('in-memory SSO connection store', () => {
	test('saves and retrieves a connection by id', async () => {
		const store = createInMemorySsoConnectionStore();

		await store.saveConnection(oidcConnection());
		const found = await store.getConnection('conn-oidc-1');

		expect(found?.type).toBe('oidc');
		expect(found?.config).toEqual({
			clientId: 'client-1',
			clientSecret: 'secret-1',
			issuer: 'https://idp.example.com',
			redirectUri: 'https://app.example.com/sso/oidc/org-1/callback',
			scopes: ['openid', 'email', 'profile']
		});
	});

	test('resolves the enabled connection for an organization, narrowed by type', async () => {
		const store = createInMemorySsoConnectionStore();

		await store.saveConnection(oidcConnection());
		await store.saveConnection(samlConnection());

		const anyConnection = await store.getConnectionByOrganization('org-1');
		const samlOnly = await store.getConnectionByOrganization(
			'org-1',
			'saml'
		);

		expect(anyConnection).toBeDefined();
		expect(samlOnly?.connectionId).toBe('conn-saml-1');
	});

	test('does not resolve a disabled connection for sign-in', async () => {
		const store = createInMemorySsoConnectionStore();

		await store.saveConnection(oidcConnection({ enabled: false }));

		expect(
			await store.getConnectionByOrganization('org-1', 'oidc')
		).toBeUndefined();
		// ...but it is still listed for admin management.
		expect(await store.listConnectionsByOrganization('org-1')).toHaveLength(
			1
		);
	});

	test('lists an organization newest-first', async () => {
		const store = createInMemorySsoConnectionStore();

		await store.saveConnection(oidcConnection({ updatedAt: 1000 }));
		await store.saveConnection(samlConnection({ updatedAt: 3000 }));

		const listed = await store.listConnectionsByOrganization('org-1');

		expect(listed.map((connection) => connection.connectionId)).toEqual([
			'conn-saml-1',
			'conn-oidc-1'
		]);
	});

	test('clones scopes so external mutation does not leak in', async () => {
		const store = createInMemorySsoConnectionStore();
		const connection = oidcConnection();

		await store.saveConnection(connection);
		connection.config.scopes.push('offline_access');
		const found = await store.getConnection('conn-oidc-1');

		expect(found?.config).toBeDefined();
		expect(found?.type === 'oidc' ? found.config.scopes : []).toEqual([
			'openid',
			'email',
			'profile'
		]);
	});

	test('deletes a connection', async () => {
		const store = createInMemorySsoConnectionStore();

		await store.saveConnection(oidcConnection());
		await store.deleteConnection('conn-oidc-1');

		expect(await store.getConnection('conn-oidc-1')).toBeUndefined();
	});
});
