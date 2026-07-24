// OpenID4VCI issuer-side primitives. The minimum that lets a wallet (EUDI Wallet,
// Microsoft Authenticator, etc.) collect an SD-JWT VC issued by your IdP using the
// pre-authorized_code flow.
//
//   1. Consumer mints a credential offer via `createCredentialOffer({userId, ...})`.
//      The offer carries an opaque `pre-authorized_code` the wallet trades at /token.
//   2. Wallet hits /token with grant_type=`urn:ietf:params:oauth:grant-type:pre-authorized_code`,
//      receives an access_token bound to the offer.
//   3. Wallet POSTs the access_token to /vci/credential, optionally with a `proof.jwt` that
//      proves possession of the wallet key it wants the credential cnf-bound to.
//   4. We call `vci.resolveCredentialClaims({userId, configurationId})` and issue the SD-JWT VC.
//
// Discovery lives at `/.well-known/openid-credential-issuer` (RFC-style, per spec).
// `/vci/nonce` issues a fresh `c_nonce` the wallet uses when signing its proof JWT.

import { generateSecureToken, hashToken } from '../crypto';
import type { RouteString } from '../types';
import { issueSdJwtVc } from '../vc/sdJwt';
import { signJwt, verifyJwt, type SigningKey } from './keys';

export const PRE_AUTHORIZED_CODE_GRANT =
	'urn:ietf:params:oauth:grant-type:pre-authorized_code';

const MS_PER_SECOND = 1000;
const DEFAULT_OFFER_TTL_MS = 600_000; // 10 min — the wallet typically scans + redeems immediately
const DEFAULT_ACCESS_TTL_MS = 600_000;
const DEFAULT_NONCE_TTL_MS = 300_000; // 5 min, matches the c_nonce window most issuers use
const PRE_AUTH_CODE_BYTES = 32;
const C_NONCE_BYTES = 16;

// One credential the issuer advertises in its metadata. The wallet picks one by `id`.
export type CredentialConfiguration = {
	// E.g. `vc+sd-jwt`. Only `vc+sd-jwt` is supported in this slice; mdoc + JWT-VC are deferred.
	format: 'vc+sd-jwt';
	id: string;
	// Optional human-readable display info for the wallet UI.
	display?: Array<{ locale?: string; name: string }>;
	// The order claims should be rendered in (display hint for the wallet).
	order?: string[];
	// The selectively-disclosable claim names the issuer commits to supporting.
	claims?: Record<
		string,
		{ display?: Array<{ locale?: string; name: string }> }
	>;
	// `vct` claim value embedded in the issued credential (SD-JWT VC type URI).
	vct: string;
};

export type CredentialOffer = {
	clientId: string;
	configurationId: string;
	createdAt: number;
	expiresAt: number;
	preAuthorizedCodeHash: string;
	redeemed: boolean;
	userId: string;
};

export type CredentialOfferStore = {
	consumeOffer: (
		preAuthorizedCodeHash: string
	) => Promise<CredentialOffer | undefined>;
	saveOffer: (offer: CredentialOffer) => Promise<void>;
};

export type CredentialNonceRecord = {
	expiresAt: number;
	nonceHash: string;
};

export type CredentialNonceStore = {
	consumeNonce: (
		nonceHash: string
	) => Promise<CredentialNonceRecord | undefined>;
	saveNonce: (record: CredentialNonceRecord) => Promise<void>;
};

export type VciConfig = {
	accessTokenTtlMs?: number;
	credentialConfigurations: CredentialConfiguration[];
	credentialNonceStore?: CredentialNonceStore;
	credentialOfferStore: CredentialOfferStore;
	nonceTtlMs?: number;
	offerTtlMs?: number;
	// Resolve the selectively-disclosable claims for the credential the wallet is collecting.
	// Returns the full claim bag — the issuer hashes every entry and emits a disclosure for each.
	resolveCredentialClaims: (context: {
		configurationId: string;
		userId: string;
	}) => Promise<Record<string, unknown>> | Record<string, unknown>;
	// Optional — claims to embed UNCONDITIONALLY in every issued VC (e.g. `vct` is taken from the
	// configuration, `iss` from the discovery URL; this is the slot for `nbf`, `exp`, etc.).
	resolveProtectedClaims?: (context: {
		configurationId: string;
		userId: string;
	}) => Promise<Record<string, unknown>> | Record<string, unknown>;
	// VCI-specific issuer signing key. Defaults to the OIDC signing key when omitted, so a
	// consumer that already runs the OIDC provider doesn't need to manage two keys; you'd
	// override when you want VC issuance under a different KID (e.g. an eIDAS-attested key).
	signingKey?: SigningKey;
	vciRoute?: RouteString;
};

export const DEFAULT_VCI_ROUTE: RouteString = '/vci';

const nowSeconds = (timeMs: number) => Math.floor(timeMs / MS_PER_SECOND);

// Mint a credential offer the wallet redeems via /token. The plaintext `preAuthorizedCode` is
// returned exactly once — embed it into the QR-encoded offer URI you hand to the wallet. Only
// the hash is persisted.
export const createCredentialOffer = async ({
	clientId,
	configurationId,
	now = Date.now(),
	store,
	ttlMs = DEFAULT_OFFER_TTL_MS,
	userId
}: {
	clientId: string;
	configurationId: string;
	now?: number;
	store: CredentialOfferStore;
	ttlMs?: number;
	userId: string;
}) => {
	const preAuthorizedCode = generateSecureToken(PRE_AUTH_CODE_BYTES);
	const preAuthorizedCodeHash = await hashToken(preAuthorizedCode);
	const offer: CredentialOffer = {
		clientId,
		configurationId,
		createdAt: now,
		expiresAt: now + ttlMs,
		preAuthorizedCodeHash,
		redeemed: false,
		userId
	};
	await store.saveOffer(offer);

	return { offer, preAuthorizedCode };
};

export type PreAuthExchangeResult =
	| { error: 'expired_token' | 'invalid_grant'; ok: false }
	| {
			access_token: string;
			c_nonce?: string;
			c_nonce_expires_in?: number;
			expires_in: number;
			ok: true;
			token_type: 'Bearer';
	  };

// Exchange a pre-authorized_code for a VCI access token. The access token is a signed JWT (so
// /vci/credential is stateless) bound to the offer's userId + configurationId.
export const exchangePreAuthorizedCode = async ({
	config,
	issuer,
	now = Date.now(),
	preAuthorizedCode,
	signingKey
}: {
	config: VciConfig;
	issuer: string;
	now?: number;
	preAuthorizedCode: string;
	signingKey: SigningKey;
}) => {
	const failFor = (
		error: Extract<PreAuthExchangeResult, { ok: false }>['error']
	) => {
		const failure: PreAuthExchangeResult = { error, ok: false };

		return failure;
	};
	const hash = await hashToken(preAuthorizedCode);
	const offer = await config.credentialOfferStore.consumeOffer(hash);
	if (offer === undefined || offer.redeemed) return failFor('invalid_grant');
	if (offer.expiresAt < now) return failFor('expired_token');

	const ttlMs = config.accessTokenTtlMs ?? DEFAULT_ACCESS_TTL_MS;
	const accessToken = await signJwt(
		{
			aud: issuer,
			exp: nowSeconds(now + ttlMs),
			iat: nowSeconds(now),
			iss: issuer,
			scope: `openid_credential:${offer.configurationId}`,
			sub: offer.userId,
			vci_configuration_id: offer.configurationId
		},
		signingKey
	);

	const result: PreAuthExchangeResult = {
		access_token: accessToken,
		expires_in: Math.floor(ttlMs / MS_PER_SECOND),
		ok: true,
		token_type: 'Bearer'
	};

	if (config.credentialNonceStore !== undefined) {
		const nonce = generateSecureToken(C_NONCE_BYTES);
		const nonceTtlMs = config.nonceTtlMs ?? DEFAULT_NONCE_TTL_MS;
		await config.credentialNonceStore.saveNonce({
			expiresAt: now + nonceTtlMs,
			nonceHash: await hashToken(nonce)
		});
		result.c_nonce = nonce;
		result.c_nonce_expires_in = Math.floor(nonceTtlMs / MS_PER_SECOND);
	}

	return result;
};

export type CredentialIssueInput = {
	accessToken: string;
	// Wallet's proof-of-possession JWT (RFC-aligned `openid4vci-proof+jwt` typ). Optional but
	// strongly recommended — without it the issued credential has no holder binding.
	proofJwt?: string;
	requestedFormat?: string;
};

export type CredentialIssueResult =
	| { credential: string; format: 'vc+sd-jwt'; ok: true }
	| {
			error:
				| 'invalid_credential_request'
				| 'invalid_proof'
				| 'invalid_token'
				| 'unsupported_credential_format';
			ok: false;
	  };

const decodeJwtHeader = (jwt: string) => {
	const [header] = jwt.split('.');
	if (header === undefined) return undefined;
	try {
		const decoded: unknown = JSON.parse(
			Buffer.from(header, 'base64url').toString('utf8')
		);
		if (typeof decoded !== 'object' || decoded === null) return undefined;

		return decoded;
	} catch {
		return undefined;
	}
};

const extractHolderJwk = (proofJwt: string) => {
	const header = decodeJwtHeader(proofJwt);
	if (header === undefined) return undefined;
	const jwk = Reflect.get(header, 'jwk');
	if (typeof jwk !== 'object' || jwk === null) return undefined;
	// JWK is a structural type (no nominal brand) — narrow the keys we actually read.
	const candidate: {
		crv?: unknown;
		kty?: unknown;
		x?: unknown;
		y?: unknown;
	} = jwk;

	return {
		crv: typeof candidate.crv === 'string' ? candidate.crv : undefined,
		kty: typeof candidate.kty === 'string' ? candidate.kty : undefined,
		x: typeof candidate.x === 'string' ? candidate.x : undefined,
		y: typeof candidate.y === 'string' ? candidate.y : undefined
	} satisfies JsonWebKey;
};

// Verify the wallet's proof-of-possession JWT (OID4VCI §7.2.1). The JWT MUST:
//   - be signed by the key in its `header.jwk`
//   - have `aud === issuer` (the credential issuer URL)
//   - have a `nonce` claim — when `credentialNonceStore` is configured, the nonce is
//     consumed from the store (single-use, time-bounded)
// Returns the holder's JWK on success, undefined otherwise. The cnf binding the issuer
// bakes into the SD-JWT VC is taken from this verified JWK — so a wallet can't substitute
// a different key after the fact.
const verifyProofJwt = async ({
	config,
	issuer,
	now,
	proofJwt
}: {
	config: VciConfig;
	issuer: string;
	now: number;
	proofJwt: string;
}) => {
	const holderJwk = extractHolderJwk(proofJwt);
	if (holderJwk === undefined) return undefined;
	const decoded = await verifyJwt(proofJwt, holderJwk);
	if (decoded === undefined) return undefined;
	const rawPayload = decoded.payload;
	if (typeof rawPayload !== 'object' || rawPayload === null) return undefined;
	const payload: { [key: string]: unknown } = { ...rawPayload };
	if (payload.aud !== issuer) return undefined;
	if (typeof payload.iat !== 'number') return undefined;
	// Optional but enforced when configured — replay protection for the proof.
	if (config.credentialNonceStore !== undefined) {
		const { nonce } = payload;
		if (typeof nonce !== 'string') return undefined;
		const record = await config.credentialNonceStore.consumeNonce(
			await hashToken(nonce)
		);
		if (record === undefined || record.expiresAt < now) return undefined;
	}

	return holderJwk;
};

// Issue an SD-JWT VC against an authorized VCI access token. The wallet's proof.jwt (header.jwk)
// supplies the cnf binding when present.
export const buildIssuerMetadata = ({
	config,
	issuer,
	vciRoute
}: {
	config: VciConfig;
	issuer: string;
	vciRoute: RouteString;
}) => ({
	credential_configurations_supported: Object.fromEntries(
		config.credentialConfigurations.map((configuration) => [
			configuration.id,
			{
				claims: configuration.claims,
				credential_signing_alg_values_supported: ['ES256'],
				cryptographic_binding_methods_supported: ['jwk'],
				display: configuration.display,
				format: configuration.format,
				order: configuration.order,
				proof_types_supported: {
					jwt: { proof_signing_alg_values_supported: ['ES256'] }
				},
				vct: configuration.vct
			}
		])
	),
	credential_endpoint: `${issuer}${vciRoute}/credential`,
	credential_issuer: issuer,
	nonce_endpoint:
		config.credentialNonceStore === undefined
			? undefined
			: `${issuer}${vciRoute}/nonce`,
	token_endpoint: `${issuer}/oauth2/token`
});
// Tiny constructor helpers so the inline returns stay short + the result type stays
// the single-source-of-truth shape (the lint plugin rejects explicit return-type
// annotations on top-level exports).
const issueOk = (credential: string) => {
	const success: CredentialIssueResult = {
		credential,
		format: 'vc+sd-jwt',
		ok: true
	};

	return success;
};
const issueFail = (
	error: Extract<CredentialIssueResult, { ok: false }>['error']
) => {
	const failure: CredentialIssueResult = { error, ok: false };

	return failure;
};

export const issueCredential = async ({
	config,
	input,
	issuer,
	now = Date.now(),
	signingKey
}: {
	config: VciConfig;
	input: CredentialIssueInput;
	issuer: string;
	now?: number;
	signingKey: SigningKey;
}) => {
	const requested = input.requestedFormat ?? 'vc+sd-jwt';
	if (requested !== 'vc+sd-jwt')
		return issueFail('unsupported_credential_format');

	const decoded = await verifyJwt(input.accessToken, signingKey.publicJwk);
	if (decoded === undefined) return issueFail('invalid_token');
	const rawPayload = decoded.payload;
	if (typeof rawPayload !== 'object' || rawPayload === null) {
		return issueFail('invalid_token');
	}
	const payload: { [key: string]: unknown } = { ...rawPayload };
	if (typeof payload.exp === 'number' && payload.exp * MS_PER_SECOND < now) {
		return issueFail('invalid_token');
	}
	const userId = payload.sub;
	const configurationId = payload.vci_configuration_id;
	if (typeof userId !== 'string' || typeof configurationId !== 'string') {
		return issueFail('invalid_token');
	}
	const configuration = config.credentialConfigurations.find(
		(entry) => entry.id === configurationId
	);
	if (configuration === undefined)
		return issueFail('invalid_credential_request');

	let holderJwk: JsonWebKey | undefined;
	if (input.proofJwt !== undefined) {
		holderJwk = await verifyProofJwt({
			config,
			issuer,
			now,
			proofJwt: input.proofJwt
		});
		if (holderJwk === undefined) return issueFail('invalid_proof');
	}

	const selective = await config.resolveCredentialClaims({
		configurationId,
		userId
	});
	const protectedClaims = config.resolveProtectedClaims
		? await config.resolveProtectedClaims({ configurationId, userId })
		: {};

	const credential = await issueSdJwtVc({
		base: {
			iat: nowSeconds(now),
			iss: issuer,
			...protectedClaims,
			vct: configuration.vct
		},
		holderJwk,
		selective,
		signingKey
	});

	return issueOk(credential);
};
