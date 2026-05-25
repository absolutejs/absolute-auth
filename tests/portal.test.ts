import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { auth } from '../src/index';
import { createInMemorySetupSessionStore } from '../src/portal/inMemorySetupSessionStore';
import { createSetupSession } from '../src/portal/operations';
import { resolveScimOrganization } from '../src/scim/config';
import { createInMemoryScimTokenStore } from '../src/scim/inMemoryScimTokenStore';
import { createInMemorySsoConnectionStore } from '../src/sso/inMemorySsoConnectionStore';

type TestUser = {
	sub: string;
};

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const ORG = 'org-1';

const buildApp = async () => {
	const setupSessionStore = createInMemorySetupSessionStore();
	const ssoConnectionStore = createInMemorySsoConnectionStore();
	const scimTokenStore = createInMemoryScimTokenStore();
	const authInstance = await auth<TestUser>({
		portal: { scimTokenStore, setupSessionStore, ssoConnectionStore },
		providersConfiguration: {}
	});

	return {
		app: new Elysia().use(authInstance),
		scimTokenStore,
		setupSessionStore,
		ssoConnectionStore
	};
};

const portal = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	method: string,
	token: string,
	body?: unknown
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: body === undefined ? undefined : JSON.stringify(body),
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json'
			},
			method
		})
	);

describe('admin portal setup links', () => {
	test('session returns the service-provider URLs and capabilities', async () => {
		const { app, setupSessionStore } = await buildApp();
		const { token } = await createSetupSession({
			capabilities: ['sso_saml', 'scim'],
			organizationId: ORG,
			setupSessionStore
		});

		const response = await portal(
			app,
			'/auth/portal/session',
			'GET',
			token
		);
		expect(response.status).toBe(HTTP_OK);
		const body = await response.json();
		expect(body.organizationId).toBe(ORG);
		expect(body.capabilities).toContain('sso_saml');
		expect(body.saml.acsUrl).toBe(`http://localhost/sso/saml/${ORG}/acs`);
		expect(body.scim.baseUrl).toBe('http://localhost/scim/v2');
		expect(body.configured.saml).toBe(false);
	});

	test('configures a SAML connection that SSO can then resolve', async () => {
		const { app, setupSessionStore, ssoConnectionStore } = await buildApp();
		const { token } = await createSetupSession({
			capabilities: ['sso_saml'],
			organizationId: ORG,
			setupSessionStore
		});

		const response = await portal(
			app,
			'/auth/portal/connection/saml',
			'PUT',
			token,
			{
				idpEntityId: 'urn:idp',
				idpSsoUrl: 'https://idp.example/sso',
				idpX509Cert: 'CERT'
			}
		);
		expect(response.status).toBe(HTTP_OK);

		const connection = await ssoConnectionStore.getConnectionByOrganization(
			ORG,
			'saml'
		);
		expect(connection?.type).toBe('saml');
		expect(
			connection?.type === 'saml' ? connection.config.idpSsoUrl : ''
		).toBe('https://idp.example/sso');
	});

	test('issues a SCIM token that resolves back to the org', async () => {
		const { app, scimTokenStore, setupSessionStore } = await buildApp();
		const { token } = await createSetupSession({
			capabilities: ['scim'],
			organizationId: ORG,
			setupSessionStore
		});

		const response = await portal(
			app,
			'/auth/portal/scim/token',
			'POST',
			token
		);
		expect(response.status).toBe(HTTP_OK);
		const { token: scimToken } = await response.json();

		expect(
			await resolveScimOrganization(scimTokenStore, `Bearer ${scimToken}`)
		).toBe(ORG);
	});

	test('rejects an unknown setup token', async () => {
		const { app } = await buildApp();

		const response = await portal(
			app,
			'/auth/portal/session',
			'GET',
			'bogus-token'
		);

		expect(response.status).toBe(HTTP_UNAUTHORIZED);
	});

	test('enforces the link capabilities', async () => {
		const { app, setupSessionStore } = await buildApp();
		const { token } = await createSetupSession({
			capabilities: ['scim'],
			organizationId: ORG,
			setupSessionStore
		});

		const response = await portal(
			app,
			'/auth/portal/connection/saml',
			'PUT',
			token,
			{
				idpEntityId: 'urn:idp',
				idpSsoUrl: 'https://idp.example/sso',
				idpX509Cert: 'CERT'
			}
		);

		expect(response.status).toBe(HTTP_FORBIDDEN);
	});
});
