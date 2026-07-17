// In-house ES256 (ECDSA P-256) JWT signing + JWK utilities for the OIDC provider — no JWT
// dependency, consistent with the rest of the package's WebCrypto-only crypto. Used to sign
// id_tokens and access tokens, serve JWKS, and verify DPoP proofs.

type SigningKeyIdentity = {
	kid: string;
	publicJwk: JsonWebKey;
};

/** ES256 signing material can remain local for development or be delegated to
 * a non-exportable KMS/HSM adapter. External signers return the 64-byte JOSE
 * ECDSA signature (r || s), not an ASN.1 DER envelope. */
export type SigningKey = SigningKeyIdentity &
	(
		| { privateJwk: JsonWebKey; sign?: never }
		| {
				privateJwk?: never;
				sign: (input: Uint8Array) => Promise<Uint8Array>;
		  }
	);

const ENCODER = new TextEncoder();
const ES256 = { hash: 'SHA-256', name: 'ECDSA' } as const;
const KEY_PARAMS = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ES256_JOSE_SIGNATURE_BYTES = 64;

const toBase64Url = (bytes: ArrayBuffer | Uint8Array) =>
	Buffer.from(
		bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
	).toString('base64url');

const fromBase64Url = (value: string) =>
	new Uint8Array(Buffer.from(value, 'base64url'));

const encodeSegment = (value: unknown) =>
	Buffer.from(JSON.stringify(value)).toString('base64url');

const decodeSegment = (segment: string) => {
	try {
		const value: unknown = JSON.parse(
			Buffer.from(segment, 'base64url').toString('utf8')
		);
		if (
			typeof value !== 'object' ||
			value === null ||
			Array.isArray(value)
		) {
			return undefined;
		}

		return Object.fromEntries(Object.entries(value));
	} catch {
		return undefined;
	}
};

// Generate an ES256 signing key. Persist `privateJwk` (it signs tokens); `publicJwk` is served
// from JWKS. `kid` is the JWK thumbprint.
export const generateSigningKey = async (): Promise<SigningKey> => {
	const pair = await crypto.subtle.generateKey(KEY_PARAMS, true, [
		'sign',
		'verify'
	]);
	const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
	const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

	return { kid: await jwkThumbprint(publicJwk), privateJwk, publicJwk };
};

// RFC 7638 JWK thumbprint over an EC key's required members, in lexicographic order.
export const jwkThumbprint = async (jwk: JsonWebKey) => {
	const canonical = JSON.stringify({
		crv: jwk.crv,
		kty: jwk.kty,
		x: jwk.x,
		y: jwk.y
	});

	return toBase64Url(
		await crypto.subtle.digest('SHA-256', ENCODER.encode(canonical))
	);
};

// Sign a compact ES256 JWT.
export const signJwt = async (
	payload: Record<string, unknown>,
	signing: SigningKey,
	typ = 'JWT'
) => {
	const input = `${encodeSegment({ alg: 'ES256', kid: signing.kid, typ })}.${encodeSegment(payload)}`;
	const encoded = ENCODER.encode(input);
	let signature: ArrayBuffer | Uint8Array;
	if (signing.sign !== undefined) {
		signature = await signing.sign(encoded);
	} else {
		const key = await crypto.subtle.importKey(
			'jwk',
			signing.privateJwk,
			KEY_PARAMS,
			false,
			['sign']
		);
		signature = await crypto.subtle.sign(ES256, key, encoded);
	}
	if (signature.byteLength !== ES256_JOSE_SIGNATURE_BYTES) {
		throw new Error('ES256 signer must return a 64-byte JOSE signature');
	}

	return `${input}.${toBase64Url(signature)}`;
};

// The public JWK as served from the JWKS endpoint (adds kid/use/alg).
export const toPublicJwk = (key: SigningKey) => ({
	alg: 'ES256',
	crv: key.publicJwk.crv,
	kid: key.kid,
	kty: key.publicJwk.kty,
	use: 'sig',
	x: key.publicJwk.x,
	y: key.publicJwk.y
});

// Verify a compact ES256 JWT against a public JWK; returns the decoded header + payload, or
// undefined if the signature is invalid or malformed. (Expiry/claims are checked by callers.)
export const verifyJwt = async (token: string, publicJwk: JsonWebKey) => {
	const [headerSegment, payloadSegment, signatureSegment] = token.split('.');
	if (
		headerSegment === undefined ||
		payloadSegment === undefined ||
		signatureSegment === undefined
	) {
		return undefined;
	}
	const key = await crypto.subtle.importKey(
		'jwk',
		publicJwk,
		KEY_PARAMS,
		false,
		['verify']
	);
	const valid = await crypto.subtle.verify(
		ES256,
		key,
		fromBase64Url(signatureSegment),
		ENCODER.encode(`${headerSegment}.${payloadSegment}`)
	);
	if (!valid) return undefined;
	const header = decodeSegment(headerSegment);
	const payload = decodeSegment(payloadSegment);
	if (header === undefined || payload === undefined) return undefined;

	return {
		header,
		payload
	};
};
