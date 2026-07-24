import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { generateSigningKey, signJwt, type SigningKey } from '../src/oidc/keys';
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

// Helper: wallet builds a proof-of-possession JWT over the c_nonce + audience using its
// holder key. The package's verifier enforces the header.jwk matches the signing key, the
// aud matches the credential issuer, and the nonce was minted by the server.
const buildHolderProofJwt = async ({
	audience,
	holderKey,
	nonce
}: {
	audience: string;
	holderKey: SigningKey;
	nonce: string;
}) => {
	// We need a header that includes `jwk`. signJwt builds its own header (alg/kid/typ); for
	// OID4VCI proof we want the wallet's public JWK embedded so the issuer knows what to
	// verify against. Construct the JWT manually here.
	const msPerSecond = 1000;
	const header: {
		alg: string;
		jwk: JsonWebKey;
		kid: string;
		typ: string;
	} = {
		alg: 'ES256',
		jwk: holderKey.publicJwk,
		kid: holderKey.kid,
		typ: 'openid4vci-proof+jwt'
	};
	const payload: { aud: string; iat: number; nonce: string } = {
		aud: audience,
		iat: Math.floor(Date.now() / msPerSecond),
		nonce
	};
	const headerSegment = Buffer.from(JSON.stringify(header)).toString(
		'base64url'
	);
	const payloadSegment = Buffer.from(JSON.stringify(payload)).toString(
		'base64url'
	);
	const signingInput = `${headerSegment}.${payloadSegment}`;
	// We sign by going through signJwt then swapping its header for ours — the WebCrypto
	// signature is over the {header}.{payload} string, so we have to compute it with our
	// custom header. Implement a thin custom signer using the same crypto primitives signJwt
	// uses internally.
	const cryptoKey = await crypto.subtle.importKey(
		'jwk',
		holderKey.privateJwk,
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign']
	);
	const signature = new Uint8Array(
		await crypto.subtle.sign(
			{ hash: 'SHA-256', name: 'ECDSA' },
			cryptoKey,
			new TextEncoder().encode(signingInput)
		)
	);

	return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
};
void signJwt;

const buildConfig = (
	signingKey: Awaited<ReturnType<typeof generateSigningKey>>
) => {
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

	test('binds the credential to the wallet key when proof.jwt verifies', async () => {
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
		const cNonce = exchange.c_nonce;
		expect(cNonce).toBeDefined();
		if (cNonce === undefined) return;

		// Real proof.jwt — wallet signs over the c_nonce + audience with its private key.
		// The package now verifies the proof signature + nonce + audience before honoring cnf.
		const proofJwt = await buildHolderProofJwt({
			audience: ISSUER,
			holderKey,
			nonce: cNonce
		});

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

	test('rejects a proof.jwt signed with a key other than its header.jwk', async () => {
		const signingKey = await generateSigningKey();
		const realHolderKey = await generateSigningKey();
		const attackerKey = await generateSigningKey();
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
		if (!exchange.ok) throw new Error('exchange failed');
		const cNonce = exchange.c_nonce;
		if (cNonce === undefined) throw new Error('no c_nonce');
		// Header claims realHolderKey's public JWK but the JWT is signed by attackerKey —
		// signature verification against the header.jwk will fail.
		const { generateSigningKey: gen, signJwt } = await import(
			'../src/oidc/keys'
		);
		void gen;
		const forgedHeader = Buffer.from(
			JSON.stringify({
				alg: 'ES256',
				jwk: realHolderKey.publicJwk,
				kid: attackerKey.kid,
				typ: 'openid4vci-proof+jwt'
			})
		).toString('base64url');
		const forgedSigned = await signJwt(
			{ aud: ISSUER, iat: Math.floor(Date.now() / 1000), nonce: cNonce },
			attackerKey
		);
		const [, payload, signature] = forgedSigned.split('.');
		const proofJwt = `${forgedHeader}.${payload}.${signature}`;
		const result = await issueCredential({
			config,
			input: { accessToken: exchange.access_token, proofJwt },
			issuer: ISSUER,
			signingKey
		});
		expect(result).toEqual({ error: 'invalid_proof', ok: false });
	});

	test('rejects a proof.jwt with the wrong audience', async () => {
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
		if (!exchange.ok) throw new Error('exchange failed');
		const cNonce = exchange.c_nonce;
		if (cNonce === undefined) throw new Error('no c_nonce');
		const proofJwt = await buildHolderProofJwt({
			audience: 'https://wrong-issuer.example',
			holderKey,
			nonce: cNonce
		});
		const result = await issueCredential({
			config,
			input: { accessToken: exchange.access_token, proofJwt },
			issuer: ISSUER,
			signingKey
		});
		expect(result).toEqual({ error: 'invalid_proof', ok: false });
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
		expect(
			metadata.credential_configurations_supported.identity_v1.vct
		).toBe('https://credentials.acme.test/identity_v1');
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
				requestedFormat: 'mso_mdoc'
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
