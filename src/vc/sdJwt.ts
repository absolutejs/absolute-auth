// SD-JWT VC primitives (draft-ietf-oauth-sd-jwt-vc + draft-ietf-oauth-selective-disclosure-jwt).
// The bare protocol layer the OpenID4VCI routes (`../oidc/vci.ts`) build on. Built on the same
// WebCrypto ES256 primitives as the OIDC provider's `signJwt` / `verifyJwt` so the package keeps
// its zero-runtime-dep crypto promise.
//
// Format (issuance): `<jwt>~<disclosure1>~<disclosure2>~…~`
// Format (presentation): same but with only the selected disclosures, optionally followed by a
// holder-signed key-binding JWT (`<jwt>~<d1>~<d2>~<kb_jwt>`).
//
// Each disclosure is a base64url-encoded JSON array `[salt, claimName, claimValue]`. The issuer
// SHA-256s each disclosure's base64url string and stores the hashes in the JWT payload's `_sd`
// array; the verifier rehashes presented disclosures and matches them back. Holder binding rides
// through the `cnf.jwk` claim — the holder's public JWK the verifier expects key-binding proofs
// from.

import { signJwt, verifyJwt, type SigningKey } from '../oidc/keys';

const SALT_BYTES = 16;
const SD_ALG = 'sha-256';

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) =>
	Buffer.from(
		bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
	).toString('base64url');

const fromBase64Url = (value: string) =>
	new Uint8Array(Buffer.from(value, 'base64url'));

const randomSalt = () => {
	const bytes = new Uint8Array(SALT_BYTES);
	crypto.getRandomValues(bytes);

	return toBase64Url(bytes);
};

const sha256 = async (input: string) => {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(input)
	);

	return toBase64Url(digest);
};

// One selectively-disclosable claim, serialized exactly as it'll appear on the wire (the verifier
// hashes the wire bytes — re-encoding loses the hash match).
export type SdDisclosure = {
	claimName: string;
	claimValue: unknown;
	encoded: string;
	salt: string;
};

const encodeDisclosure = (
	claimName: string,
	claimValue: unknown
): SdDisclosure => {
	const salt = randomSalt();
	const tuple = JSON.stringify([salt, claimName, claimValue]);
	const encoded = Buffer.from(tuple).toString('base64url');

	return { claimName, claimValue, encoded, salt };
};

export type SdJwtVcIssueInput = {
	// Claims that always travel with the credential (e.g. `iss`, `iat`, `vct`, `nbf`). The issuer
	// adds `_sd`, `_sd_alg`, and (when `holderJwk` is set) `cnf.jwk` automatically — don't
	// pass those yourself.
	base: Record<string, unknown>;
	// Holder's public JWK for cnf binding. When set, the presentation's `kb_jwt` must be signed
	// by the matching private key.
	holderJwk?: JsonWebKey;
	// Claims the issuer hides behind salted hashes — the holder chooses which to reveal at
	// presentation time. Maps `claimName -> claimValue`.
	selective: Record<string, unknown>;
	signingKey: SigningKey;
};

// Issue an SD-JWT VC. Returns the `<jwt>~<d1>~<d2>~` wire form (trailing `~` per spec — that's
// the marker that no key-binding JWT follows).
export const issueSdJwtVc = async (input: SdJwtVcIssueInput) => {
	const disclosures = Object.entries(input.selective).map(([name, value]) =>
		encodeDisclosure(name, value)
	);
	const sdDigests = await Promise.all(
		disclosures.map((disclosure) => sha256(disclosure.encoded))
	);
	const payload: Record<string, unknown> = {
		...input.base,
		_sd: sdDigests,
		_sd_alg: SD_ALG
	};
	if (input.holderJwk !== undefined) payload.cnf = { jwk: input.holderJwk };

	const jwt = await signJwt(payload, input.signingKey);
	const tail = disclosures.map((disclosure) => disclosure.encoded).join('~');

	return `${jwt}~${tail}~`;
};

export type ParsedSdJwtVc = {
	disclosures: string[];
	jwt: string;
	keyBindingJwt: string | undefined;
};

// Split the `~` wire form. Trailing empty segment (the spec-mandated terminator) is dropped; the
// last segment after a non-empty trailer is treated as the key-binding JWT (`kb_jwt`).
export const parseSdJwtVc = (token: string): ParsedSdJwtVc => {
	const segments = token.split('~');
	const jwt = segments[0] ?? '';
	const tail = segments.slice(1);
	// Trailing empty segment = no kb_jwt; non-empty trailing segment = kb_jwt.
	const last = tail[tail.length - 1];
	const hasKeyBinding = last !== undefined && last !== '';
	const keyBindingJwt = hasKeyBinding ? last : undefined;
	const disclosureCount = hasKeyBinding ? tail.length - 1 : tail.length - 1;
	const disclosures = tail
		.slice(0, disclosureCount)
		.filter((entry) => entry !== '');

	return { disclosures, jwt, keyBindingJwt };
};

// Present an SD-JWT VC by dropping disclosures the holder doesn't want to reveal. Keeps only
// disclosures whose `claimName` is in `selectedClaims`. Pass a `keyBindingJwt` (signed by the
// holder over the verifier's nonce + transcript hash) when the verifier requires it.
export const presentSdJwtVc = (
	parsed: ParsedSdJwtVc,
	selectedClaims: string[],
	keyBindingJwt?: string
) => {
	const selectedSet = new Set(selectedClaims);
	const kept = parsed.disclosures.filter((encoded) => {
		const tuple = decodeDisclosure(encoded);

		return tuple !== undefined && selectedSet.has(tuple.claimName);
	});
	const tail = kept.join('~');
	const suffix = keyBindingJwt === undefined ? '' : keyBindingJwt;

	return `${parsed.jwt}~${tail}~${suffix}`;
};

const DISCLOSURE_TUPLE_LENGTH = 3;

const decodeDisclosure = (encoded: string) => {
	try {
		const raw = Buffer.from(encoded, 'base64url').toString('utf8');
		const tuple: unknown = JSON.parse(raw);
		if (!Array.isArray(tuple) || tuple.length !== DISCLOSURE_TUPLE_LENGTH) {
			return undefined;
		}
		const [salt, claimName, claimValue] = tuple;
		if (typeof salt !== 'string' || typeof claimName !== 'string') {
			return undefined;
		}
		const decoded: SdDisclosure = { claimName, claimValue, encoded, salt };

		return decoded;
	} catch {
		return undefined;
	}
};

export type VerifiedSdJwtVc = {
	cnf: { jwk: JsonWebKey } | undefined;
	disclosedClaims: Record<string, unknown>;
	keyBindingJwt: string | undefined;
	protectedClaims: Record<string, unknown>;
};

export type SdJwtVcVerifyInput = {
	issuerPublicJwk: JsonWebKey;
	token: string;
};

// Verify an SD-JWT VC presentation: validate the issuer signature, decode disclosures, rehash
// each one and confirm it's in `_sd`, then return the always-protected claims, the
// selectively-disclosed claims, and the holder-binding JWK (when present). Returns undefined on
// any failure (bad signature, hash mismatch, malformed disclosure) — fail-closed.
export const verifySdJwtVc = async (input: SdJwtVcVerifyInput) => {
	const parsed = parseSdJwtVc(input.token);
	const decoded = await verifyJwt(parsed.jwt, input.issuerPublicJwk);
	if (decoded === undefined) return undefined;

	const rawPayload = decoded.payload;
	if (typeof rawPayload !== 'object' || rawPayload === null) return undefined;
	const payload: { [key: string]: unknown } = { ...rawPayload };
	const sdArray = payload._sd;
	const sdAlg = payload._sd_alg;
	if (!Array.isArray(sdArray) || sdAlg !== SD_ALG) return undefined;
	const acceptedHashes = new Set(
		sdArray.filter((entry): entry is string => typeof entry === 'string')
	);

	const disclosedClaims: Record<string, unknown> = {};
	for (const encoded of parsed.disclosures) {
		const hash = await sha256(encoded);
		if (!acceptedHashes.has(hash)) return undefined;
		const tuple = decodeDisclosure(encoded);
		if (tuple === undefined) return undefined;
		disclosedClaims[tuple.claimName] = tuple.claimValue;
	}

	// Strip protocol-internal fields from the returned protected claims; the consumer wants the
	// VC content, not the SD machinery.
	const protectedClaims: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload)) {
		if (key === '_sd' || key === '_sd_alg' || key === 'cnf') continue;
		protectedClaims[key] = value;
	}

	const cnf = extractCnf(payload.cnf);
	const result: VerifiedSdJwtVc = {
		cnf,
		disclosedClaims,
		keyBindingJwt: parsed.keyBindingJwt,
		protectedClaims
	};

	return result;
};

const extractCnf = (value: unknown) => {
	if (typeof value !== 'object' || value === null) return undefined;
	const jwk = Reflect.get(value, 'jwk');
	if (typeof jwk !== 'object' || jwk === null) return undefined;
	// JWK is structural; narrow the fields we read.
	const candidate: {
		crv?: unknown;
		kty?: unknown;
		x?: unknown;
		y?: unknown;
	} = jwk;
	const narrowed = {
		crv: typeof candidate.crv === 'string' ? candidate.crv : undefined,
		kty: typeof candidate.kty === 'string' ? candidate.kty : undefined,
		x: typeof candidate.x === 'string' ? candidate.x : undefined,
		y: typeof candidate.y === 'string' ? candidate.y : undefined
	} satisfies JsonWebKey;

	return { jwk: narrowed };
};

// Re-exported so consumers that don't import the OIDC keys module can still build holder JWKs
// in tests / scripts.
export { fromBase64Url, toBase64Url };
