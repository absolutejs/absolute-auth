import { beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { createInMemorySamlServiceProviderStore } from '../src/sso/inMemorySamlServiceProviderStore';
import { samlIdpRoutes } from '../src/sso/samlIdpRoutes';
import type { SamlIdpAdapter } from '../src/sso/config';
import type { UserSessionId } from '../src/types';

type TestUser = { email: string; sub: string };

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FOUND = 302;

const SESSION_ID: UserSessionId = '11111111-1111-4111-8111-111111111111';
const IDP_ENTITY_ID = 'https://idp.example';
const SP_ENTITY_ID = 'https://sp.example';
const ACS_URL = 'https://sp.example/saml/acs';

const buildRelayStateInput = (relayState?: string) =>
	relayState === undefined
		? ''
		: `<input name="RelayState" value="${relayState}">`;

// Minimal stub adapter — exercises the routes without real XML or crypto. Encodes the
// AuthnRequest as `<id>|<issuer>` so the test can vary it inline; verifies signatures
// only when given a serviceProvider (second-pass call); produces a fake SAML Response
// the auto-post form embeds verbatim so we can assert on it.
const stubAdapter: SamlIdpAdapter = {
	buildAutoPostForm: ({ acsUrl, relayState, samlResponse }) =>
		`<html><body><form action="${acsUrl}" method="POST">` +
		`<input name="SAMLResponse" value="${samlResponse}">` +
		buildRelayStateInput(relayState) +
		'</form></body></html>',
	createSamlResponse: ({
		acsUrl,
		audience,
		inResponseTo,
		nameId,
		sessionIndex
	}) =>
		`SAML:${audience}:${acsUrl}:${nameId}:${sessionIndex}:${inResponseTo ?? ''}`,
	getIdpMetadata: ({ entityId, ssoUrl }) =>
		`<EntityDescriptor entityID="${entityId}"><IDPSSODescriptor><SingleSignOnService Location="${ssoUrl}"/></IDPSSODescriptor></EntityDescriptor>`,
	parseAuthnRequest: ({ samlRequest, serviceProvider, signature }) => {
		const [id, issuer, forceAuthn, relayHint] = samlRequest.split('|');
		// Second-pass call must verify signature when the SP has a registered cert.
		if (
			serviceProvider !== undefined &&
			serviceProvider.signingCert !== undefined &&
			signature !== 'valid-signature'
		) {
			throw new Error('bad signature');
		}

		return {
			acsUrl: undefined,
			forceAuthn: forceAuthn === 'force',
			id: id ?? 'req-default',
			issuer: issuer ?? '',
			// Empty-string segment from the simple `|`-split means "no relay state
			// embedded in the AuthnRequest" — route should fall back to body.RelayState.
			relayState:
				relayHint === undefined || relayHint.length === 0
					? undefined
					: relayHint
		};
	}
};

const buildApp = async () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const samlServiceProviderStore = createInMemorySamlServiceProviderStore();
	await samlServiceProviderStore.saveServiceProvider({
		acsUrl: ACS_URL,
		createdAt: Date.now(),
		entityId: SP_ENTITY_ID,
		updatedAt: Date.now()
	});
	await authSessionStore.setSession(SESSION_ID, {
		authenticatedAt: Date.now(),
		expiresAt: Date.now() + 60 * 60 * 1000,
		user: { email: 'alice@acme.test', sub: 'user-alice' }
	});
	const app = new Elysia().use(
		samlIdpRoutes<TestUser>({
			authSessionStore,
			idpAdapter: stubAdapter,
			idpEntityId: IDP_ENTITY_ID,
			loginUrl: 'https://idp.example/signin',
			samlServiceProviderStore,
			getNameId: (user) => user.email,
			getSamlAttributes: (user) => ({ sub: user.sub })
		})
	);

	return { app, samlServiceProviderStore };
};

describe('SAML 2.0 IdP role — SP-initiated', () => {
	let app: Elysia;
	beforeEach(async () => {
		const built = await buildApp();
		({ app } = built);
	});

	test('POST /sso/saml/idp/sso → 200 + auto-post form with SAMLResponse', async () => {
		const response = await app.handle(
			new Request('http://localhost/sso/saml/idp/sso', {
				body: new URLSearchParams({
					RelayState: 'state-xyz',
					SAMLRequest: `req-123|${SP_ENTITY_ID}|prompt|`
				}),
				headers: { cookie: `user_session_id=${SESSION_ID}` },
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_OK);
		const body = await response.text();
		expect(response.headers.get('content-type')).toContain('text/html');
		expect(body).toContain(`action="${ACS_URL}"`);
		expect(body).toContain(
			`SAML:${SP_ENTITY_ID}:${ACS_URL}:alice@acme.test`
		);
		expect(body).toContain(':req-123'); // inResponseTo echoed
		expect(body).toContain('state-xyz');
	});

	test('GET /sso/saml/idp/sso (Redirect binding) same shape', async () => {
		const params = new URLSearchParams({
			SAMLRequest: `req-redir|${SP_ENTITY_ID}|prompt|`
		});
		const response = await app.handle(
			new Request(
				`http://localhost/sso/saml/idp/sso?${params.toString()}`,
				{
					headers: { cookie: `user_session_id=${SESSION_ID}` }
				}
			)
		);
		expect(response.status).toBe(HTTP_OK);
		expect(await response.text()).toContain(':req-redir');
	});

	test('unknown SP → 400 unknown_service_provider', async () => {
		const response = await app.handle(
			new Request('http://localhost/sso/saml/idp/sso', {
				body: new URLSearchParams({
					SAMLRequest: `req-456|https://random-sp.example|prompt|`
				}),
				headers: { cookie: `user_session_id=${SESSION_ID}` },
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_BAD_REQUEST);
		expect((await response.json()).error).toBe('unknown_service_provider');
	});

	test('no session → 302 to loginUrl with return_to', async () => {
		const response = await app.handle(
			new Request('http://localhost/sso/saml/idp/sso', {
				body: new URLSearchParams({
					SAMLRequest: `req-789|${SP_ENTITY_ID}|prompt|`
				}),
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location') ?? '').toContain(
			'idp.example/signin'
		);
		expect(response.headers.get('location') ?? '').toContain('return_to=');
	});

	test('forceAuthn=true → redirects to login even with a session', async () => {
		const response = await app.handle(
			new Request('http://localhost/sso/saml/idp/sso', {
				body: new URLSearchParams({
					SAMLRequest: `req-force|${SP_ENTITY_ID}|force|`
				}),
				headers: { cookie: `user_session_id=${SESSION_ID}` },
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location') ?? '').toContain(
			'idp.example/signin'
		);
	});

	test('signed AuthnRequest with a registered cert is verified via the adapter', async () => {
		// Register a new SP with a cert; bad signatures get rejected.
		const { app: signedApp, samlServiceProviderStore } = await buildApp();
		await samlServiceProviderStore.saveServiceProvider({
			acsUrl: 'https://signed-sp.example/acs',
			createdAt: Date.now(),
			entityId: 'https://signed-sp.example',
			signingCert: 'PEM-FAKE-CERT',
			updatedAt: Date.now()
		});

		const params = new URLSearchParams({
			SAMLRequest: `req-signed|https://signed-sp.example|prompt|`,
			SigAlg: 'rsa-sha256',
			Signature: 'wrong-signature'
		});
		const bad = await signedApp.handle(
			new Request(
				`http://localhost/sso/saml/idp/sso?${params.toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(bad.status).toBe(HTTP_BAD_REQUEST);
		expect((await bad.json()).error).toBe('invalid_authn_request');

		params.set('Signature', 'valid-signature');
		const good = await signedApp.handle(
			new Request(
				`http://localhost/sso/saml/idp/sso?${params.toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(good.status).toBe(HTTP_OK);
	});

	test('missing SAMLRequest → 400', async () => {
		const response = await app.handle(
			new Request('http://localhost/sso/saml/idp/sso', {
				body: new URLSearchParams({}),
				headers: { cookie: `user_session_id=${SESSION_ID}` },
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_BAD_REQUEST);
		expect((await response.json()).error).toBe('missing_saml_request');
	});
});

describe('SAML 2.0 IdP role — IdP-initiated + metadata', () => {
	let app: Elysia;
	beforeEach(async () => {
		const built = await buildApp();
		({ app } = built);
	});

	test('GET /sso/saml/idp/sso/initiate?sp= mints a Response without an AuthnRequest', async () => {
		const params = new URLSearchParams({
			RelayState: 'go-here-after',
			sp: SP_ENTITY_ID
		});
		const response = await app.handle(
			new Request(
				`http://localhost/sso/saml/idp/sso/initiate?${params.toString()}`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(response.status).toBe(HTTP_OK);
		const body = await response.text();
		expect(body).toContain(`action="${ACS_URL}"`);
		expect(body).toContain('go-here-after');
	});

	test('initiate without a session → loginUrl redirect', async () => {
		const response = await app.handle(
			new Request(
				`http://localhost/sso/saml/idp/sso/initiate?sp=${SP_ENTITY_ID}`
			)
		);
		expect(response.status).toBe(HTTP_FOUND);
		expect(response.headers.get('location') ?? '').toContain(
			'idp.example/signin'
		);
	});

	test('initiate with unknown SP → 400', async () => {
		const response = await app.handle(
			new Request(
				`http://localhost/sso/saml/idp/sso/initiate?sp=https://random-sp.example`,
				{ headers: { cookie: `user_session_id=${SESSION_ID}` } }
			)
		);
		expect(response.status).toBe(HTTP_BAD_REQUEST);
	});

	test('GET /sso/saml/idp/metadata returns adapter-rendered XML', async () => {
		const response = await app.handle(
			new Request('http://localhost/sso/saml/idp/metadata')
		);
		expect(response.status).toBe(HTTP_OK);
		expect(response.headers.get('content-type')).toContain(
			'application/samlmetadata+xml'
		);
		const body = await response.text();
		expect(body).toContain(`entityID="${IDP_ENTITY_ID}"`);
		expect(body).toContain('/sso/saml/idp/sso');
	});
});
