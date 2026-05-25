import { describe, expect, test } from 'bun:test';
import { auth } from '../src/index';
import { createInMemorySsoConnectionStore } from '../src/sso/inMemorySsoConnectionStore';
import type { SamlAdapter, SsoIdentity } from '../src/sso/config';
import type { SamlConnection } from '../src/sso/types';

type TestUser = {
	email: string;
	sub: string;
};

const HTTP_FOUND = 302;
const HTTP_NOT_FOUND = 404;
const IDP_SSO_URL = 'https://idp.test/sso';

const samlConnection: SamlConnection = {
	config: {
		idpEntityId: 'urn:idp',
		idpSsoUrl: IDP_SSO_URL,
		idpX509Cert: 'CERT'
	},
	connectionId: 'conn-saml',
	createdAt: 1,
	enabled: true,
	organizationId: 'acme',
	type: 'saml',
	updatedAt: 1
};

const fakeSamlAdapter: SamlAdapter = {
	createAuthorizationUrl: ({ connection, relayState }) =>
		`${connection.config.idpSsoUrl}?SAMLRequest=req&RelayState=${encodeURIComponent(
			relayState ?? '/'
		)}`,
	getServiceProviderMetadata: ({ acsUrl }) =>
		`<EntityDescriptor><ACS>${acsUrl}</ACS></EntityDescriptor>`,
	validateAssertion: () =>
		Promise.resolve({
			attributes: { department: 'engineering' },
			email: 'sam@acme.test',
			nameId: 'saml-user-1',
			sessionIndex: 'idx-1'
		})
};

const buildAuth = (
	getSsoUser: (identity: SsoIdentity) => TestUser,
	seed: boolean
) => {
	const ssoConnectionStore = createInMemorySsoConnectionStore();
	const app = auth<TestUser>({
		providersConfiguration: {},
		sso: { getSsoUser, samlAdapter: fakeSamlAdapter, ssoConnectionStore }
	});

	return seed
		? ssoConnectionStore.saveConnection(samlConnection).then(() => app)
		: app;
};

const resolveUser = (identity: SsoIdentity): TestUser => ({
	email: identity.email ?? '',
	sub: identity.sub
});

describe('SAML SSO routes', () => {
	test('authorize 404s for an organization with no SAML connection', async () => {
		const app = await buildAuth(resolveUser, false);

		const response = await app.handle(
			new Request('http://localhost/sso/saml/acme/authorize')
		);

		expect(response.status).toBe(HTTP_NOT_FOUND);
	});

	test('authorize redirects to the IdP SSO URL', async () => {
		const app = await buildAuth(resolveUser, true);

		const response = await app.handle(
			new Request('http://localhost/sso/saml/acme/authorize', {
				redirect: 'manual'
			})
		);

		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location') ?? '').toContain(IDP_SSO_URL);
	});

	test('acs validates the assertion, creates a session, and redirects', async () => {
		let captured: SsoIdentity | undefined;
		const app = await buildAuth((identity) => {
			captured = identity;

			return resolveUser(identity);
		}, true);

		const response = await app.handle(
			new Request('http://localhost/sso/saml/acme/acs', {
				body: 'SAMLResponse=abc&RelayState=%2Fdashboard',
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST',
				redirect: 'manual'
			})
		);

		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location')).toBe('/dashboard');
		expect(response.headers.getSetCookie().join(';')).toContain(
			'user_session_id'
		);
		expect(captured?.protocol).toBe('saml');
		expect(captured?.sub).toBe('saml-user-1');
		expect(captured?.email).toBe('sam@acme.test');
		expect(
			captured?.protocol === 'saml' ? captured.sessionIndex : undefined
		).toBe('idx-1');
	});

	test('serves SP metadata as XML', async () => {
		const app = await buildAuth(resolveUser, true);

		const response = await app.handle(
			new Request('http://localhost/sso/saml/acme/metadata')
		);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain(
			'application/xml'
		);
		expect(await response.text()).toContain('EntityDescriptor');
	});
});
