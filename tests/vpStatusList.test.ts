import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { generateSigningKey, signJwt } from '../src/oidc/keys';
import { createInMemoryPresentationRequestStore } from '../src/vc/inMemoryVpStores';
import {
	buildHolderKeyBindingJwt,
	createPresentationRequest,
	verifyPresentationResponse,
	type Vp4Config
} from '../src/vc/openid4vp';
import { issueSdJwtVc, parseSdJwtVc, presentSdJwtVc } from '../src/vc/sdJwt';
import {
	buildStatusClaim,
	createStatusList,
	getCredentialStatus,
	setCredentialStatus,
	signStatusList,
	verifyStatusListJwt
} from '../src/vc/statusList';
import { statusListRoutes } from '../src/vc/statusListRoutes';
import { vpRoutes } from '../src/vc/vpRoutes';

// G6 second slice — verifier-side OID4VP + Bitstring Status List.

const ISSUER = 'https://issuer.example';
const VERIFIER = 'https://verifier.example';
const RP_CLIENT_ID = 'rp.acme.test';
const VCT = 'https://credentials.example/identity_v1';
const STATUS_URI = `${ISSUER}/vc/status/list-1`;
const STATUS_LIST_SIZE = 1024; // small list for tests

const buildVpConfig = async (issuerKey: Awaited<ReturnType<typeof generateSigningKey>>) => {
	const clientSigningKey = await generateSigningKey();

	return {
		clientSigningKey,
		defaultExpectedIssuerPublicJwk: issuerKey.publicJwk,
		requestStore: createInMemoryPresentationRequestStore(),
		getResponseUri: (id: string) => `${VERIFIER}/vp/response?state=${id}`
	} satisfies Vp4Config;
};

describe('Bitstring Status List — bit math', () => {
	test('createStatusList yields all-zero bytes of the right size', () => {
		const bits = createStatusList(STATUS_LIST_SIZE);
		expect(bits.length).toBe(STATUS_LIST_SIZE / 8);
		expect(bits.every((byte) => byte === 0)).toBe(true);
	});

	test('set + get round-trip for arbitrary indices', () => {
		const bits = createStatusList(STATUS_LIST_SIZE);
		const indices = [0, 1, 7, 8, 9, 63, 64, 100, 500, 1023];
		for (const idx of indices) setCredentialStatus(bits, idx, 1);
		for (const idx of indices) {
			expect(getCredentialStatus(bits, idx)).toBe(1);
		}
		// untouched indices stay 0
		expect(getCredentialStatus(bits, 2)).toBe(0);
		expect(getCredentialStatus(bits, 200)).toBe(0);
	});

	test('rejects sizes not a multiple of 8', () => {
		expect(() => createStatusList(7)).toThrow();
	});

	test('rejects out-of-range indices', () => {
		const bits = createStatusList(STATUS_LIST_SIZE);
		expect(() => setCredentialStatus(bits, STATUS_LIST_SIZE + 1, 1)).toThrow();
	});
});

describe('Bitstring Status List — JWT sign + verify round-trip', () => {
	test('signs an unrevoked list and reads the bits back', async () => {
		const key = await generateSigningKey();
		const bits = createStatusList(STATUS_LIST_SIZE);
		setCredentialStatus(bits, 42, 1);
		const jwt = await signStatusList({
			bits,
			issuer: ISSUER,
			listUri: STATUS_URI,
			signingKey: key
		});
		const verified = await verifyStatusListJwt({
			issuerPublicJwk: key.publicJwk,
			token: jwt
		});
		expect(verified).toBeDefined();
		const bitsPerByte = 8;
		const idx = 42;
		const byte = verified?.bits[Math.floor(idx / bitsPerByte)] ?? 0;
		expect(((byte >> (idx % bitsPerByte)) & 1) === 1).toBe(true);
	});
});

describe('OID4VP verifier — happy path', () => {
	test('mint request → wallet presents → verifier accepts disclosed claims', async () => {
		const issuerKey = await generateSigningKey();
		const holderKey = await generateSigningKey();
		const vpConfig = await buildVpConfig(issuerKey);

		// Issuer mints a credential bound to the holder
		const credential = await issueSdJwtVc({
			base: { iss: ISSUER, vct: VCT },
			holderJwk: holderKey.publicJwk,
			selective: { is_over_21: true, postal_code: '94110' },
			signingKey: issuerKey
		});

		// Verifier creates a presentation request
		const requested = ['is_over_21'];
		const { request, nonce } = await createPresentationRequest({
			config: vpConfig,
			input: { clientId: RP_CLIENT_ID, requestedClaims: requested },
			issuer: VERIFIER,
			getRequestUri: (id) => `${VERIFIER}/vp/request/${id}`
		});

		// Holder builds the presentation (drops postal_code; keeps is_over_21)
		const parsed = parseSdJwtVc(credential);
		const kbJwt = await buildHolderKeyBindingJwt({
			audience: RP_CLIENT_ID,
			holderKey,
			nonce
		});
		const vpToken = presentSdJwtVc(parsed, requested, kbJwt);

		// Verifier verifies
		const result = await verifyPresentationResponse({
			config: vpConfig,
			input: { requestId: request.requestId, vpToken }
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.verified.disclosedClaims).toEqual({ is_over_21: true });
		expect(result.verified.disclosedClaims).not.toHaveProperty('postal_code');
		expect(result.verified.holderJwk?.x).toBe(holderKey.publicJwk.x);
	});
});

describe('OID4VP verifier — failure modes', () => {
	test('rejects when the requested claim was not disclosed', async () => {
		const issuerKey = await generateSigningKey();
		const holderKey = await generateSigningKey();
		const vpConfig = await buildVpConfig(issuerKey);
		const credential = await issueSdJwtVc({
			base: { iss: ISSUER, vct: VCT },
			holderJwk: holderKey.publicJwk,
			selective: { is_over_21: true, postal_code: '94110' },
			signingKey: issuerKey
		});
		const { request, nonce } = await createPresentationRequest({
			config: vpConfig,
			input: {
				clientId: RP_CLIENT_ID,
				requestedClaims: ['postal_code', 'date_of_birth']
			},
			issuer: VERIFIER,
			getRequestUri: (id) => `${VERIFIER}/vp/request/${id}`
		});
		const parsed = parseSdJwtVc(credential);
		const kbJwt = await buildHolderKeyBindingJwt({
			audience: RP_CLIENT_ID,
			holderKey,
			nonce
		});
		// Wallet only presents postal_code; date_of_birth was not even in the credential.
		const vpToken = presentSdJwtVc(parsed, ['postal_code'], kbJwt);
		const result = await verifyPresentationResponse({
			config: vpConfig,
			input: { requestId: request.requestId, vpToken }
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toBe('missing_claims');
	});

	test('rejects when the wallet uses a different holder key than the credential cnf', async () => {
		const issuerKey = await generateSigningKey();
		const realHolderKey = await generateSigningKey();
		const attackerKey = await generateSigningKey();
		const vpConfig = await buildVpConfig(issuerKey);
		const credential = await issueSdJwtVc({
			base: { iss: ISSUER, vct: VCT },
			holderJwk: realHolderKey.publicJwk,
			selective: { is_over_21: true },
			signingKey: issuerKey
		});
		const { request, nonce } = await createPresentationRequest({
			config: vpConfig,
			input: { clientId: RP_CLIENT_ID, requestedClaims: ['is_over_21'] },
			issuer: VERIFIER,
			getRequestUri: (id) => `${VERIFIER}/vp/request/${id}`
		});
		const parsed = parseSdJwtVc(credential);
		// Attacker signs the kb_jwt — it won't verify against the credential's cnf.jwk.
		const kbJwt = await buildHolderKeyBindingJwt({
			audience: RP_CLIENT_ID,
			holderKey: attackerKey,
			nonce
		});
		const vpToken = presentSdJwtVc(parsed, ['is_over_21'], kbJwt);
		const result = await verifyPresentationResponse({
			config: vpConfig,
			input: { requestId: request.requestId, vpToken }
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toBe('invalid_holder_binding');
	});

	test('rejects a stale nonce (request reused after expiry)', async () => {
		const issuerKey = await generateSigningKey();
		const holderKey = await generateSigningKey();
		const vpConfig: Vp4Config = {
			...(await buildVpConfig(issuerKey)),
			requestTtlMs: 1
		};
		const credential = await issueSdJwtVc({
			base: { iss: ISSUER, vct: VCT },
			holderJwk: holderKey.publicJwk,
			selective: { is_over_21: true },
			signingKey: issuerKey
		});
		const baseTime = 1_700_000_000_000;
		const { request, nonce } = await createPresentationRequest({
			config: vpConfig,
			input: {
				clientId: RP_CLIENT_ID,
				now: baseTime,
				requestedClaims: ['is_over_21']
			},
			issuer: VERIFIER,
			getRequestUri: (id) => `${VERIFIER}/vp/request/${id}`
		});
		const parsed = parseSdJwtVc(credential);
		const kbJwt = await buildHolderKeyBindingJwt({
			audience: RP_CLIENT_ID,
			holderKey,
			nonce
		});
		const vpToken = presentSdJwtVc(parsed, ['is_over_21'], kbJwt);
		const result = await verifyPresentationResponse({
			config: vpConfig,
			input: { requestId: request.requestId, vpToken },
			now: baseTime + 60_000
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toBe('expired_request');
	});

	test('rejects when requestId is unknown', async () => {
		const issuerKey = await generateSigningKey();
		const vpConfig = await buildVpConfig(issuerKey);
		const result = await verifyPresentationResponse({
			config: vpConfig,
			input: { requestId: 'never-saved', vpToken: 'header.payload.sig~' }
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toBe('unknown_request');
	});
});

describe('OID4VP verifier — status list integration', () => {
	test('refuses a presentation whose credential bit is set in the status list', async () => {
		const issuerKey = await generateSigningKey();
		const statusKey = issuerKey; // issuer also signs its status list
		const holderKey = await generateSigningKey();
		const bits = createStatusList(STATUS_LIST_SIZE);
		setCredentialStatus(bits, 7, 1);

		const statusJwt = await signStatusList({
			bits,
			issuer: ISSUER,
			listUri: STATUS_URI,
			signingKey: statusKey
		});
		const vpConfig: Vp4Config = {
			...(await buildVpConfig(issuerKey)),
			statusListPublicJwk: statusKey.publicJwk,
			statusListResolver: async (uri) =>
				uri === STATUS_URI ? statusJwt : undefined
		};

		const credential = await issueSdJwtVc({
			base: { iss: ISSUER, status: buildStatusClaim(7, STATUS_URI), vct: VCT },
			holderJwk: holderKey.publicJwk,
			selective: { is_over_21: true },
			signingKey: issuerKey
		});
		const { request, nonce } = await createPresentationRequest({
			config: vpConfig,
			input: { clientId: RP_CLIENT_ID, requestedClaims: ['is_over_21'] },
			issuer: VERIFIER,
			getRequestUri: (id) => `${VERIFIER}/vp/request/${id}`
		});
		const parsed = parseSdJwtVc(credential);
		const kbJwt = await buildHolderKeyBindingJwt({
			audience: RP_CLIENT_ID,
			holderKey,
			nonce
		});
		const vpToken = presentSdJwtVc(parsed, ['is_over_21'], kbJwt);
		const result = await verifyPresentationResponse({
			config: vpConfig,
			input: { requestId: request.requestId, vpToken }
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toBe('revoked_credential');
	});

	test('accepts a presentation whose credential bit is NOT set', async () => {
		const issuerKey = await generateSigningKey();
		const holderKey = await generateSigningKey();
		const bits = createStatusList(STATUS_LIST_SIZE);
		setCredentialStatus(bits, 1, 1); // revoke a DIFFERENT credential

		const statusJwt = await signStatusList({
			bits,
			issuer: ISSUER,
			listUri: STATUS_URI,
			signingKey: issuerKey
		});
		const vpConfig: Vp4Config = {
			...(await buildVpConfig(issuerKey)),
			statusListPublicJwk: issuerKey.publicJwk,
			statusListResolver: async () => statusJwt
		};
		const credential = await issueSdJwtVc({
			base: { iss: ISSUER, status: buildStatusClaim(7, STATUS_URI), vct: VCT },
			holderJwk: holderKey.publicJwk,
			selective: { is_over_21: true },
			signingKey: issuerKey
		});
		const { request, nonce } = await createPresentationRequest({
			config: vpConfig,
			input: { clientId: RP_CLIENT_ID, requestedClaims: ['is_over_21'] },
			issuer: VERIFIER,
			getRequestUri: (id) => `${VERIFIER}/vp/request/${id}`
		});
		const parsed = parseSdJwtVc(credential);
		const kbJwt = await buildHolderKeyBindingJwt({
			audience: RP_CLIENT_ID,
			holderKey,
			nonce
		});
		const vpToken = presentSdJwtVc(parsed, ['is_over_21'], kbJwt);
		const result = await verifyPresentationResponse({
			config: vpConfig,
			input: { requestId: request.requestId, vpToken }
		});
		expect(result.ok).toBe(true);
	});
});

describe('vpRoutes — HTTP surface', () => {
	test('POST /vp/authorize → GET /vp/request/:id → POST /vp/response round-trip', async () => {
		const issuerKey = await generateSigningKey();
		const holderKey = await generateSigningKey();
		const vpConfig = await buildVpConfig(issuerKey);
		let verifiedClaim: Record<string, unknown> | undefined;
		const app = new Elysia().use(
			vpRoutes({
				defaultClientId: RP_CLIENT_ID,
				issuerUrl: VERIFIER,
				vpConfig,
				onVerifiedPresentation: ({ verified }) => {
					verifiedClaim = verified.disclosedClaims;
				}
			})
		);

		const authorize = await app.handle(
			new Request(`${VERIFIER}/vp/authorize`, {
				body: JSON.stringify({ requested_claims: ['is_over_21'] }),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(authorize.status).toBe(200);
		const authorizeBody = await authorize.json();
		expect(typeof authorizeBody.nonce).toBe('string');
		expect(typeof authorizeBody.requestId).toBe('string');

		const requestObject = await app.handle(
			new Request(`${VERIFIER}/vp/request/${authorizeBody.requestId}`)
		);
		expect(requestObject.status).toBe(200);
		expect(requestObject.headers.get('content-type')).toContain(
			'application/oauth-authz-req+jwt'
		);

		const credential = await issueSdJwtVc({
			base: { iss: ISSUER, vct: VCT },
			holderJwk: holderKey.publicJwk,
			selective: { is_over_21: true },
			signingKey: issuerKey
		});
		const parsed = parseSdJwtVc(credential);
		const kbJwt = await buildHolderKeyBindingJwt({
			audience: RP_CLIENT_ID,
			holderKey,
			nonce: authorizeBody.nonce
		});
		const vpToken = presentSdJwtVc(parsed, ['is_over_21'], kbJwt);

		const response = await app.handle(
			new Request(`${VERIFIER}/vp/response`, {
				body: JSON.stringify({
					state: authorizeBody.requestId,
					vp_token: vpToken
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(response.status).toBe(200);
		const respBody = await response.json();
		expect(respBody.verified).toBe(true);
		expect(respBody.disclosed_claims).toEqual({ is_over_21: true });
		expect(verifiedClaim).toEqual({ is_over_21: true });
	});
});

describe('statusListRoutes — GET /vc/status/:listId', () => {
	test('serves a signed status list that round-trips through verifyStatusListJwt', async () => {
		const issuerKey = await generateSigningKey();
		const bits = createStatusList(STATUS_LIST_SIZE);
		setCredentialStatus(bits, 17, 1);
		const app = new Elysia().use(
			statusListRoutes({
				issuerUrl: ISSUER,
				signingKey: issuerKey,
				getStatusList: () => bits
			})
		);
		const response = await app.handle(
			new Request(`${ISSUER}/vc/status/list-1`)
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain(
			'application/statuslist+jwt'
		);
		const jwt = await response.text();
		const verified = await verifyStatusListJwt({
			issuerPublicJwk: issuerKey.publicJwk,
			token: jwt
		});
		expect(verified).toBeDefined();
		const bitsPerByte = 8;
		const idx = 17;
		const byte = verified?.bits[Math.floor(idx / bitsPerByte)] ?? 0;
		expect(((byte >> (idx % bitsPerByte)) & 1) === 1).toBe(true);
	});

	test('returns 404 for an unknown listId', async () => {
		const issuerKey = await generateSigningKey();
		const app = new Elysia().use(
			statusListRoutes({
				issuerUrl: ISSUER,
				signingKey: issuerKey,
				getStatusList: () => undefined
			})
		);
		const response = await app.handle(
			new Request(`${ISSUER}/vc/status/unknown`)
		);
		expect(response.status).toBe(404);
	});

	test('exposed for completeness — signJwt utility is reachable from package surface', async () => {
		const issuerKey = await generateSigningKey();
		const jwt = await signJwt({ hello: 'world' }, issuerKey);
		expect(typeof jwt).toBe('string');
	});
});
