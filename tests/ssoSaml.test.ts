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

let capturedLogout: { nameId: string; sessionIndex?: string } | undefined;

const fakeSamlAdapter: SamlAdapter = {
	createAuthorizationUrl: ({ connection, relayState }) =>
		`${connection.config.idpSsoUrl}?SAMLRequest=req&RelayState=${encodeURIComponent(
			relayState ?? '/'
		)}`,
	createLogoutRequestUrl: ({
		connection,
		nameId,
		relayState,
		sessionIndex
	}) => {
		capturedLogout = { nameId, sessionIndex };

		return `${connection.config.idpSloUrl ?? ''}?SAMLRequest=logout&RelayState=${encodeURIComponent(
			relayState ?? '/'
		)}`;
	},
	createLogoutResponseUrl: ({ connection }) =>
		`${connection.config.idpSloUrl ?? ''}?SAMLResponse=ok`,
	getServiceProviderMetadata: ({ acsUrl }) =>
		`<EntityDescriptor><ACS>${acsUrl}</ACS></EntityDescriptor>`,
	validateAssertion: () =>
		Promise.resolve({
			attributes: { department: 'engineering' },
			email: 'sam@acme.test',
			nameId: 'saml-user-1',
			sessionIndex: 'idx-1'
		}),
	validateLogoutRequest: () =>
		Promise.resolve({
			nameId: 'saml-user-1',
			relayState: '/',
			requestId: 'req-1',
			sessionIndex: 'idx-1'
		}),
	validateLogoutResponse: () => Promise.resolve()
};

const sloConnection: SamlConnection = {
	...samlConnection,
	config: { ...samlConnection.config, idpSloUrl: 'https://idp.test/slo' }
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

	test('logout clears the session and bounces to the IdP SLO endpoint', async () => {
		const ssoConnectionStore = createInMemorySsoConnectionStore();
		const app = auth<TestUser>({
			providersConfiguration: {},
			sso: {
				getSsoUser: resolveUser,
				samlAdapter: fakeSamlAdapter,
				ssoConnectionStore
			}
		});
		await ssoConnectionStore.saveConnection({
			...samlConnection,
			config: {
				...samlConnection.config,
				idpSloUrl: 'https://idp.test/slo'
			}
		});

		const response = await (
			await app
		).handle(
			new Request('http://localhost/sso/saml/acme/logout', {
				headers: {
					cookie: 'user_session_id=11111111-1111-1111-1111-111111111111'
				},
				redirect: 'manual'
			})
		);

		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location')).toBe('https://idp.test/slo');
		expect(response.headers.getSetCookie().join(';')).toContain(
			'user_session_id'
		);
	});
});

describe('SAML Single Logout (signed)', () => {
	const sessionCookie = (response: Response) =>
		response.headers
			.getSetCookie()
			.find((cookie) => cookie.startsWith('user_session_id='))
			?.split(';')[0] ?? '';

	const buildSloApp = async () => {
		const ssoConnectionStore = createInMemorySsoConnectionStore();
		await ssoConnectionStore.saveConnection(sloConnection);

		return auth<TestUser>({
			providersConfiguration: {},
			sso: {
				getSsoUser: resolveUser,
				samlAdapter: fakeSamlAdapter,
				ssoConnectionStore
			}
		});
	};

	test('SP-initiated logout sends a signed LogoutRequest with the session NameID', async () => {
		capturedLogout = undefined;
		const app = await buildSloApp();

		const acs = await app.handle(
			new Request('http://localhost/sso/saml/acme/acs', {
				body: 'SAMLResponse=abc&RelayState=%2F',
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST',
				redirect: 'manual'
			})
		);
		const cookie = sessionCookie(acs);
		expect(cookie.length).toBeGreaterThan(0);

		const logout = await app.handle(
			new Request('http://localhost/sso/saml/acme/logout', {
				headers: { cookie },
				redirect: 'manual'
			})
		);

		expect(logout.status).toBe(HTTP_FOUND);
		const location = logout.headers.get('location') ?? '';
		expect(location).toContain('https://idp.test/slo');
		expect(location).toContain('SAMLRequest=logout');
		expect(capturedLogout?.nameId).toBe('saml-user-1');
		expect(capturedLogout?.sessionIndex).toBe('idx-1');
	});

	test('the SLO endpoint validates the IdP LogoutResponse', async () => {
		const app = await buildSloApp();

		const response = await app.handle(
			new Request(
				'http://localhost/sso/saml/acme/slo?SAMLResponse=ok&RelayState=%2Fbye',
				{ redirect: 'manual' }
			)
		);

		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location')).toBe('/bye');
	});

	test('an IdP-initiated LogoutRequest clears the session and replies', async () => {
		const app = await buildSloApp();

		const response = await app.handle(
			new Request(
				'http://localhost/sso/saml/acme/slo?SAMLRequest=logout',
				{
					headers: {
						cookie: 'user_session_id=22222222-2222-2222-2222-222222222222'
					},
					redirect: 'manual'
				}
			)
		);

		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location')).toContain('SAMLResponse=ok');
		expect(response.headers.getSetCookie().join(';')).toContain(
			'user_session_id'
		);
	});
});
