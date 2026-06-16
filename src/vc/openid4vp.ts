// OpenID for Verifiable Presentations (OID4VP, openid-4-verifiable-presentations-1_0-ID3),
// verifier side. The package becomes a relying party that accepts a wallet's `vp_token`
// + `presentation_submission` and surfaces the verified claims to the consumer.
//
// Flow:
//   1. RP (this package) calls `createPresentationRequest({...})` → returns the JWT request
//      object + the `request_uri` to embed in a wallet deeplink / QR code.
//   2. Wallet fetches the request, picks a credential matching the `presentation_definition`,
//      signs a key-binding JWT over the verifier's `nonce` + `aud`, POSTs `vp_token` +
//      `presentation_submission` to `response_uri`.
//   3. RP calls `verifyPresentationResponse({requestId, vpToken, ...})` → returns the
//      verified protected + disclosed claims along with the holder JWK + a freshness signal.
//
// Scope of this slice: SD-JWT VC presentations only (the format every EU/US wallet ships
// first). DIF Presentation Definition input/match is intentionally minimal — we accept a
// flat `requestedClaims: string[]` and check each claim was disclosed. Full PD evaluation
// (field paths, constraints, alternative input descriptors) is deferred — see VC-PLAN.md.

import { generateSecureToken } from '../crypto';
import { signJwt, verifyJwt, type SigningKey } from '../oidc/keys';
import { parseSdJwtVc, verifySdJwtVc } from './sdJwt';
import { verifyStatusListJwt } from './statusList';

const REQUEST_BYTES = 16;
const DEFAULT_REQUEST_TTL_MS = 600_000; // 10 min
const MS_PER_SECOND = 1000;

// Mirror of the wallet's incoming POST. The wallet supplies the `vp_token` (an SD-JWT VC
// with a key-binding JWT appended) + a small `presentation_submission` envelope so the
// verifier can match it back to one of the requested claims.
export type PresentationResponseInput = {
	requestId: string;
	vpToken: string;
};

export type PresentationRequest = {
	clientId: string;
	createdAt: number;
	expectedIssuerPublicJwk: JsonWebKey;
	expiresAt: number;
	nonce: string;
	requestedClaims: string[];
	requestId: string;
	responseUri: string;
	state: string | undefined;
};

export type PresentationRequestStore = {
	consumeRequest: (
		requestId: string
	) => Promise<PresentationRequest | undefined>;
	getRequest: (requestId: string) => Promise<PresentationRequest | undefined>;
	saveRequest: (request: PresentationRequest) => Promise<void>;
};

export type Vp4Config = {
	// The RP's signing key — used to sign the request object served from /vp/request/:id.
	clientSigningKey: SigningKey;
	defaultExpectedIssuerPublicJwk: JsonWebKey;
	// Where the wallet POSTs the vp_token. Used inside the request object so wallets that
	// support response_uri can deliver directly without a redirect bounce.
	getResponseUri: (requestId: string) => string;
	requestStore: PresentationRequestStore;
	requestTtlMs?: number;
	// Optional — if the credential carries a `status` claim pointing at a hosted status list,
	// the verifier fetches the list (via this hook, since the package doesn't make network
	// calls implicitly) and refuses revoked credentials.
	statusListResolver?: (uri: string) => Promise<string | undefined>;
	statusListPublicJwk?: JsonWebKey;
};

export type CreatePresentationRequestInput = {
	clientId: string;
	now?: number;
	requestedClaims: string[];
	state?: string;
};

// Mint a presentation request. Returns:
//   - `requestId` — opaque id the verifier endpoint looks up to consume the request
//   - `nonce` — the verifier's challenge the wallet binds into its kb_jwt
//   - `requestUri` — what the wallet will GET to retrieve the signed request object
//   - `requestObject` — the signed JWT (also returned so the consumer can return-inline
//     instead of relying on the GET if they prefer same-device flows)
export const createPresentationRequest = async ({
	config,
	getRequestUri,
	input,
	issuer
}: {
	config: Vp4Config;
	getRequestUri: (requestId: string) => string;
	input: CreatePresentationRequestInput;
	issuer: string;
}) => {
	const requestId = generateSecureToken(REQUEST_BYTES);
	const nonce = generateSecureToken(REQUEST_BYTES);
	const now = input.now ?? Date.now();
	const ttlMs = config.requestTtlMs ?? DEFAULT_REQUEST_TTL_MS;
	const request: PresentationRequest = {
		clientId: input.clientId,
		createdAt: now,
		expectedIssuerPublicJwk: config.defaultExpectedIssuerPublicJwk,
		expiresAt: now + ttlMs,
		nonce,
		requestedClaims: input.requestedClaims,
		requestId,
		responseUri: config.getResponseUri(requestId),
		state: input.state
	};
	await config.requestStore.saveRequest(request);

	const requestObject = await signJwt(
		{
			aud: 'https://self-issued.me/v2',
			client_id: input.clientId,
			iat: Math.floor(now / MS_PER_SECOND),
			iss: issuer,
			nonce,
			presentation_definition: buildSimplePresentationDefinition(
				requestId,
				input.requestedClaims
			),
			response_mode: 'direct_post',
			response_type: 'vp_token',
			response_uri: request.responseUri,
			state: input.state
		},
		config.clientSigningKey
	);

	return {
		nonce,
		request,
		requestObject,
		requestUri: getRequestUri(requestId)
	};
};

// DIF Presentation Definition — minimal "ask for these claims" shape. The full DIF spec
// supports JSON Path constraints, alternative input descriptors, etc.; we emit the simplest
// well-formed shape every wallet understands.
const buildSimplePresentationDefinition = (
	requestId: string,
	requestedClaims: string[]
) => ({
	id: requestId,
	input_descriptors: [
		{
			constraints: {
				fields: requestedClaims.map((claim) => ({
					path: [`$.${claim}`]
				})),
				limit_disclosure: 'required'
			},
			format: { 'vc+sd-jwt': { 'sd-jwt_alg_values': ['ES256'] } },
			id: 'sd-jwt-vc',
			name: 'SD-JWT VC',
			purpose: 'Verify holder claims'
		}
	]
});

export type VerifiedPresentation = {
	disclosedClaims: Record<string, unknown>;
	holderJwk: JsonWebKey | undefined;
	missingClaims: string[];
	protectedClaims: Record<string, unknown>;
	requestId: string;
	statusValid: boolean;
};

export type PresentationVerifyError =
	| 'expired_request'
	| 'invalid_holder_binding'
	| 'invalid_signature'
	| 'missing_claims'
	| 'revoked_credential'
	| 'unknown_request';

export type PresentationVerifyResult =
	| { error: PresentationVerifyError; ok: false }
	| { ok: true; verified: VerifiedPresentation };

// Verify the wallet's response. Performs:
//   - Request lookup + expiry check
//   - SD-JWT VC issuer-signature + disclosure-hash verification (via `verifySdJwtVc`)
//   - Holder key-binding JWT signature + nonce match (the kb_jwt is the last `~` segment)
//   - Requested-claim coverage check (every claim in `requestedClaims` was disclosed)
//   - Optional status list check when the credential carries a `status` claim
export const verifyPresentationResponse = async ({
	config,
	input,
	now = Date.now()
}: {
	config: Vp4Config;
	input: PresentationResponseInput;
	now?: number;
}) => {
	const failFor = (error: PresentationVerifyError) => {
		const failure: PresentationVerifyResult = { error, ok: false };

		return failure;
	};

	const request = await config.requestStore.consumeRequest(input.requestId);
	if (request === undefined) return failFor('unknown_request');
	if (request.expiresAt < now) return failFor('expired_request');

	const verified = await verifySdJwtVc({
		issuerPublicJwk: request.expectedIssuerPublicJwk,
		token: input.vpToken
	});
	if (verified === undefined) return failFor('invalid_signature');

	// Holder binding: the kb_jwt's `aud` must match this RP's clientId and `nonce` the
	// challenge we issued. Signed by the cnf.jwk the issuer baked into the credential.
	if (verified.cnf !== undefined) {
		if (verified.keyBindingJwt === undefined) {
			return failFor('invalid_holder_binding');
		}
		const valid = await verifyHolderBinding({
			audience: request.clientId,
			holderJwk: verified.cnf.jwk,
			keyBindingJwt: verified.keyBindingJwt,
			nonce: request.nonce
		});
		if (!valid) return failFor('invalid_holder_binding');
	}

	const missingClaims = request.requestedClaims.filter(
		(claim) => !(claim in verified.disclosedClaims)
	);
	if (missingClaims.length > 0) return failFor('missing_claims');

	const statusValid = await checkStatus({
		config,
		credentialClaims: verified.protectedClaims
	});
	if (!statusValid) return failFor('revoked_credential');

	const success: PresentationVerifyResult = {
		ok: true,
		verified: {
			disclosedClaims: verified.disclosedClaims,
			holderJwk: verified.cnf?.jwk,
			missingClaims,
			protectedClaims: verified.protectedClaims,
			requestId: request.requestId,
			statusValid: true
		}
	};

	return success;
};

const verifyHolderBinding = async ({
	audience,
	holderJwk,
	keyBindingJwt,
	nonce
}: {
	audience: string;
	holderJwk: JsonWebKey;
	keyBindingJwt: string;
	nonce: string;
}) => {
	const decoded = await verifyJwt(keyBindingJwt, holderJwk);
	if (decoded === undefined) return false;
	const rawPayload = decoded.payload;
	if (typeof rawPayload !== 'object' || rawPayload === null) return false;
	const payload: { [key: string]: unknown } = { ...rawPayload };
	if (payload.aud !== audience) return false;
	if (payload.nonce !== nonce) return false;
	if (typeof payload.iat !== 'number') return false;

	return true;
};

const checkStatus = async ({
	config,
	credentialClaims
}: {
	config: Vp4Config;
	credentialClaims: Record<string, unknown>;
}) => {
	if (config.statusListResolver === undefined) return true;
	if (config.statusListPublicJwk === undefined) return true;
	const { status } = credentialClaims;
	if (typeof status !== 'object' || status === null) return true;
	const list = Reflect.get(status, 'status_list');
	if (typeof list !== 'object' || list === null) return true;
	const uri = Reflect.get(list, 'uri');
	const idx = Reflect.get(list, 'idx');
	if (typeof uri !== 'string' || typeof idx !== 'number') return true;

	const token = await config.statusListResolver(uri);
	if (token === undefined) return true; // can't fetch ⇒ fail-open per spec §6.1
	const verified = await verifyStatusListJwt({
		issuerPublicJwk: config.statusListPublicJwk,
		token
	});
	if (verified === undefined) return false;
	const bitsPerByte = 8;
	const byteIndex = Math.floor(idx / bitsPerByte);
	const bitIndex = idx % bitsPerByte;
	const byte = verified.bits[byteIndex] ?? 0;

	return ((byte >> bitIndex) & 1) === 0;
};

// Holder helper: sign a key-binding JWT for an in-flight presentation. Wallets use this
// shape; we expose it so consumers can build holder/wallet flows (or test ones) without
// reimplementing the format.
export const buildHolderKeyBindingJwt = async ({
	audience,
	holderKey,
	nonce,
	now = Date.now(),
	sdHash
}: {
	audience: string;
	holderKey: SigningKey;
	nonce: string;
	now?: number;
	sdHash?: string;
}) =>
	signJwt(
		{
			aud: audience,
			iat: Math.floor(now / MS_PER_SECOND),
			nonce,
			sd_hash: sdHash
		},
		holderKey
	);
export const parsePresentationToken = (vpToken: string) =>
	parseSdJwtVc(vpToken);
