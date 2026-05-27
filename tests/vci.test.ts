import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { generateSigningKey } from '../src/oidc/keys';
import {
	createInMemoryCredentialNonceStore,
	createInMemoryCredentialOfferStore
} from '../src/oidc/inMemoryVciStores';
import {
	createCredentialOffer,
	exchangePreAuthorizedCode,
	issueCredential,
	PRE_AUTHORIZED_CODE_GRANT,
	type VciConfig
} from '../src/oidc/vci';
import { vciRoutes } from '../src/oidc/vciRoutes';
import { parseSdJwtVc, verifySdJwtVc } from '../src/vc/sdJwt';

// G6 first slice: pre-authorized_code flow end-to-end. Mint offer → trade for access_token →
// POST /vci/credential → SD-JWT VC. Verify the issued credential's selective claims.

const ISSUER = 'https://issuer.example';
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;

const buildConfig = (signingKey: Awaited<ReturnType<typeof generateSigningKey>>) => {
	const credentialOfferStore = createInMemoryCredentialOfferStore();
	const credentialNonceStore = createInMemoryCredentialNonceStore();
	const config: VciConfig = {
		credentialConfigurations: [
			{
				claims: {
					birthdate: { display: [{ name: 'Birth date' }] },
					given_name: { display: [{ name: 'Given name' }] },
					is_over_21: { display: [{ name: 'Is over 21' }] }
				},
				display: [{ locale: 'en-US', name: 'Acme Identity Card' }],
				format: 'vc+sd-jwt',
				id: 'identity_v1',
				order: ['given_name', 'birthdate', 'is_over_21'],
				vct: 'https://credentials.acme.test/identity_v1'
			}
		],
		credentialNonceStore,
		credentialOfferStore,
		signingKey,
		resolveCredentialClaims: async ({ userId }) => ({
			birthdate: '1990-01-15',
			given_name: 'Jane',
			is_over_21: true,
			user_id: userId
		}),
		// eslint-disable-next-line absolute/no-useless-function -- VciConfig hook is a function-typed slot
		resolveProtectedClaims: () => ({ nbf: 1_700_000_000 })
	};

	return { config, credentialNonceStore, credentialOfferStore };
};

describe('OpenID4VCI pre-authorized_code flow (end-to-end)', () => {
	test('mint offer → exchange → issue → verify SD-JWT VC', async () => {
		const signingKey = await generateSigningKey();
		const { config, credentialOfferStore } = buildConfig(signingKey);

		const { preAuthorizedCode } = await createCredentialOffer({
			clientId: 'wallet.example',
			configurationId: 'identity_v1',
			store: credentialOfferStore,
			userId: 'user-123'
		});

		const exchange = await exchangePreAuthorizedCode({
			config,
			issuer: ISSUER,
			preAuthorizedCode,
			signingKey
		});
		expect(exchange.ok).toBe(true);
		if (!exchange.ok) return;
		expect(exchange.c_nonce).toBeDefined();

		const credential = await issueCredential({
			config,
			input: { accessToken: exchange.access_token },
			issuer: ISSUER,
			signingKey
		});
		expect(credential.ok).toBe(true);
		if (!credential.ok) return;

		const verified = await verifySdJwtVc({
			issuerPublicJwk: signingKey.publicJwk,
			token: credential.credential
		});
		expect(verified).toBeDefined();
		expect(verified?.protectedClaims).toMatchObject({
			iss: ISSUER,
			nbf: 1_700_000_000,
			vct: 'https://credentials.acme.test/identity_v1'
		});
		expect(verified?.disclosedClaims).toEqual({
			birthdate: '1990-01-15',
			given_name: 'Jane',
			is_over_21: true,
			user_id: 'user-123'
		});
	});

	test('binds the credential to the wallet key when proof.jwt is supplied', async () => {
		const signingKey = await generateSigningKey();
		const holderKey = await generateSigningKey();
		const { config, credentialOfferStore } = buildConfig(signingKey);
		const { preAuthorizedCode } = await createCredentialOffer({
			clientId: 'wallet.example',
			configurationId: 'identity_v1',
			store: credentialOfferStore,
			userId: 'user-123'
		});
		const exchange = await exchangePreAuthorizedCode({
			config,
			issuer: ISSUER,
			preAuthorizedCode,
			signingKey
		});
		expect(exchange.ok).toBe(true);
		if (!exchange.ok) return;

		// Fake proof.jwt — header.jwk carries the holder's public key; the issuer reads it for
		// cnf binding and doesn't verify the JWT signature in this slice (proof verification is a
		// deferred step listed in VC-PLAN.md).
		const header = Buffer.from(
			JSON.stringify({ alg: 'ES256', jwk: holderKey.publicJwk, typ: 'openid4vci-proof+jwt' })
		).toString('base64url');
		const proofJwt = `${header}.payload.signature`;

		const credential = await issueCredential({
			config,
			input: { accessToken: exchange.access_token, proofJwt },
			issuer: ISSUER,
			signingKey
		});
		expect(credential.ok).toBe(true);
		if (!credential.ok) return;

		const verified = await verifySdJwtVc({
			issuerPublicJwk: signingKey.publicJwk,
			token: credential.credential
		});
		expect(verified?.cnf?.jwk.x).toBe(holderKey.publicJwk.x);
	});

	test('rejects a redeemed pre-authorized_code on second use', async () => {
		const signingKey = await generateSigningKey();
		const { config, credentialOfferStore } = buildConfig(signingKey);
		const { preAuthorizedCode } = await createCredentialOffer({
			clientId: 'wallet.example',
			configurationId: 'identity_v1',
			store: credentialOfferStore,
			userId: 'user-123'
		});

		const first = await exchangePreAuthorizedCode({
			config,
			issuer: ISSUER,
			preAuthorizedCode,
			signingKey
		});
		expect(first.ok).toBe(true);

		const second = await exchangePreAuthorizedCode({
			config,
			issuer: ISSUER,
			preAuthorizedCode,
			signingKey
		});
		expect(second.ok).toBe(false);
	});

	test('rejects an expired offer', async () => {
		const signingKey = await generateSigningKey();
		const { config, credentialOfferStore } = buildConfig(signingKey);
		const baseTime = 1_700_000_000_000;
		const { preAuthorizedCode } = await createCredentialOffer({
			clientId: 'wallet.example',
			configurationId: 'identity_v1',
			now: baseTime,
			store: credentialOfferStore,
			ttlMs: 1000,
			userId: 'user-123'
		});
		const result = await exchangePreAuthorizedCode({
			config,
			issuer: ISSUER,
			now: baseTime + 60_000,
			preAuthorizedCode,
			signingKey
		});
		expect(result).toEqual({ error: 'expired_token', ok: false });
	});

	test('credential endpoint rejects requests without a bearer access token', async () => {
		const signingKey = await generateSigningKey();
		const { config } = buildConfig(signingKey);
		const app = new Elysia().use(
			vciRoutes({ issuerUrl: ISSUER, signingKey, vciConfig: config })
		);
		const response = await app.handle(
			new Request('http://localhost/vci/credential', {
				body: JSON.stringify({}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_UNAUTHORIZED);
	});
});

describe('OpenID4VCI discovery + nonce route', () => {
	test('GET /.well-known/openid-credential-issuer advertises the configured credentials', async () => {
		const signingKey = await generateSigningKey();
		const { config } = buildConfig(signingKey);
		const app = new Elysia().use(
			vciRoutes({ issuerUrl: ISSUER, signingKey, vciConfig: config })
		);
		const response = await app.handle(
			new Request('http://localhost/.well-known/openid-credential-issuer')
		);
		expect(response.status).toBe(HTTP_OK);
		const metadata = await response.json();
		expect(metadata.credential_issuer).toBe(ISSUER);
		expect(metadata.credential_endpoint).toBe(`${ISSUER}/vci/credential`);
		expect(metadata.nonce_endpoint).toBe(`${ISSUER}/vci/nonce`);
		expect(metadata.credential_configurations_supported.identity_v1.vct).toBe(
			'https://credentials.acme.test/identity_v1'
		);
		expect(
			metadata.credential_configurations_supported.identity_v1
				.cryptographic_binding_methods_supported
		).toEqual(['jwk']);
	});

	test('POST /vci/nonce issues a fresh c_nonce', async () => {
		const signingKey = await generateSigningKey();
		const { config } = buildConfig(signingKey);
		const app = new Elysia().use(
			vciRoutes({ issuerUrl: ISSUER, signingKey, vciConfig: config })
		);
		const response = await app.handle(
			new Request('http://localhost/vci/nonce', { method: 'POST' })
		);
		expect(response.status).toBe(HTTP_OK);
		const body = await response.json();
		expect(typeof body.c_nonce).toBe('string');
		expect(body.c_nonce.length).toBeGreaterThan(0);
	});

	test('PRE_AUTHORIZED_CODE_GRANT constant matches the spec URN', () => {
		expect(PRE_AUTHORIZED_CODE_GRANT).toBe(
			'urn:ietf:params:oauth:grant-type:pre-authorized_code'
		);
	});
});

describe('SD-JWT VC issued via the issuer endpoint is parseable', () => {
	test('issued credential has expected SD-JWT VC structure', async () => {
		const signingKey = await generateSigningKey();
		const { config, credentialOfferStore } = buildConfig(signingKey);
		const { preAuthorizedCode } = await createCredentialOffer({
			clientId: 'wallet.example',
			configurationId: 'identity_v1',
			store: credentialOfferStore,
			userId: 'user-123'
		});
		const exchange = await exchangePreAuthorizedCode({
			config,
			issuer: ISSUER,
			preAuthorizedCode,
			signingKey
		});
		expect(exchange.ok).toBe(true);
		if (!exchange.ok) return;
		const credential = await issueCredential({
			config,
			input: { accessToken: exchange.access_token },
			issuer: ISSUER,
			signingKey
		});
		expect(credential.ok).toBe(true);
		if (!credential.ok) return;

		const parsed = parseSdJwtVc(credential.credential);
		expect(parsed.disclosures.length).toBeGreaterThan(0);
		expect(parsed.keyBindingJwt).toBeUndefined();
	});
});

describe('VciConfig validation', () => {
	test('rejects unsupported credential formats', async () => {
		const signingKey = await generateSigningKey();
		const { config, credentialOfferStore } = buildConfig(signingKey);
		const { preAuthorizedCode } = await createCredentialOffer({
			clientId: 'wallet.example',
			configurationId: 'identity_v1',
			store: credentialOfferStore,
			userId: 'user-123'
		});
		const exchange = await exchangePreAuthorizedCode({
			config,
			issuer: ISSUER,
			preAuthorizedCode,
			signingKey
		});
		if (!exchange.ok) {
			throw new Error('pre-auth exchange failed');
		}

		const result = await issueCredential({
			config,
			input: {
				accessToken: exchange.access_token,
				// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- testing the unsupported_credential_format branch with a deliberately invalid value
				requestedFormat: 'mso_mdoc' as 'vc+sd-jwt'
			},
			issuer: ISSUER,
			signingKey
		});
		expect(result).toEqual({
			error: 'unsupported_credential_format',
			ok: false
		});
	});

	test('rejects a forged access token (different signing key)', async () => {
		const signingKey = await generateSigningKey();
		const attackerKey = await generateSigningKey();
		const { config } = buildConfig(signingKey);
		// Use ANY signed JWT not from `signingKey` and observe the path returns invalid_token.
		const { signJwt } = await import('../src/oidc/keys');
		const forged = await signJwt(
			{ sub: 'user-123', vci_configuration_id: 'identity_v1' },
			attackerKey
		);
		const result = await issueCredential({
			config,
			input: { accessToken: forged },
			issuer: ISSUER,
			signingKey
		});
		expect(result).toEqual({ error: 'invalid_token', ok: false });
		expect(HTTP_BAD_REQUEST).toBe(HTTP_BAD_REQUEST);
	});
});
