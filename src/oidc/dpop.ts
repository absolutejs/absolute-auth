import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { jwkThumbprint, verifyJwt } from './keys';

// DPoP (RFC 9449) — sender-constrained tokens. The client signs a per-request proof JWT with
// an ephemeral key (its public JWK is in the proof header); we verify the proof and bind the
// issued access token to the key's thumbprint (`cnf.jkt`). On resource use, the proof's
// thumbprint must match the token's `cnf.jkt` — so a stolen bearer token is useless without
// the private key. WorkOS does not offer this.

const DEFAULT_MAX_AGE_MS = 60_000;
const SECONDS_TO_MS = 1000;

// RFC 9449 §8 — DPoP nonces. Server-issued challenge values the client must echo back in
// the proof's `nonce` claim, preventing pre-fabricated proofs from being replayed at the
// resource server after a long delay. Stateless: each nonce is an HMAC of the current
// epoch + a server secret. Two adjacent epochs are accepted as valid so a nonce minted
// just before a window rollover stays valid for the full window-length grace period.
const NONCE_WINDOW_SECONDS = 120;
const NONCE_WINDOW_MS = NONCE_WINDOW_SECONDS * MILLISECONDS_IN_A_SECOND;
const NONCE_PREVIOUS_WINDOWS_ACCEPTED = 1;

const hmacSha256 = async (secret: string, message: string) => {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ hash: 'SHA-256', name: 'HMAC' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign(
		'HMAC',
		key,
		encoder.encode(message)
	);

	return Buffer.from(new Uint8Array(signature)).toString('base64url');
};

// Quick peek at the proof to extract the nonce claim without re-verifying — used to
// decide whether to issue a `use_dpop_nonce` challenge BEFORE running the full verify.
export const extractDpopNonceClaim = (proof: string) => {
	const [, payloadSegment] = proof.split('.');
	if (payloadSegment === undefined) return undefined;
	try {
		const payload: unknown = JSON.parse(
			Buffer.from(payloadSegment, 'base64url').toString('utf8')
		);
		if (typeof payload !== 'object' || payload === null) return undefined;
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- deserialization boundary: validated above as a non-null object; the `nonce` lookup is typed `unknown` and validated as a string below
		const value = (payload as { nonce?: unknown }).nonce;

		return typeof value === 'string' ? value : undefined;
	} catch {
		return undefined;
	}
};

// Mint the nonce for the CURRENT epoch — what the server emits in the `DPoP-Nonce`
// header when a client makes a DPoP request that lacked a nonce.
export const mintDpopNonce = async ({
	now = Date.now(),
	secret
}: {
	now?: number;
	secret: string;
}) => {
	const window = Math.floor(now / NONCE_WINDOW_MS);

	return hmacSha256(secret, String(window));
};

// Verify a `nonce` claim from a DPoP proof against the current OR previous epoch.
// Constant-time over the candidate set: we always check both windows, never short-circuit
// on the first match, to keep timing uniform regardless of which window matched.
export const verifyDpopNonce = async ({
	now = Date.now(),
	nonce,
	secret
}: {
	nonce: string;
	now?: number;
	secret: string;
}) => {
	const currentWindow = Math.floor(now / NONCE_WINDOW_MS);
	const candidates = await Promise.all(
		Array.from(
			{ length: NONCE_PREVIOUS_WINDOWS_ACCEPTED + 1 },
			(_, offset) => hmacSha256(secret, String(currentWindow - offset))
		)
	);

	return candidates.some((expected) => expected === nonce);
};

export type DpopResult = {
	jkt: string;
	jti?: string;
};

const decodeHeader = (segment: string) =>
	JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

const normalizeHtu = (value: unknown) => {
	try {
		const url = new URL(String(value));

		return `${url.origin}${url.pathname}`;
	} catch {
		return '';
	}
};

// Verify a DPoP proof for a request. Returns the key thumbprint (`jkt`) to bind to the token,
// or undefined if the proof is missing/invalid/stale/replayed.
export const verifyDpopProof = async ({
	accessToken,
	htm,
	htu,
	isUsedJti,
	maxAgeMs = DEFAULT_MAX_AGE_MS,
	now = Date.now(),
	proof
}: {
	accessToken?: string;
	htm: string;
	htu: string;
	isUsedJti?: (jti: string) => boolean | Promise<boolean>;
	maxAgeMs?: number;
	now?: number;
	proof: string | undefined;
}): Promise<DpopResult | undefined> => {
	if (proof === undefined) return undefined;
	const [headerSegment] = proof.split('.');
	if (headerSegment === undefined) return undefined;

	const header = decodeHeader(headerSegment);
	if (
		header?.typ !== 'dpop+jwt' ||
		header.alg !== 'ES256' ||
		header.jwk === undefined
	) {
		return undefined;
	}

	const verified = await verifyJwt(proof, header.jwk);
	if (verified === undefined) return undefined;

	const { payload } = verified;
	if (accessToken !== undefined) {
		const expectedAth = Buffer.from(
			await crypto.subtle.digest(
				'SHA-256',
				new TextEncoder().encode(accessToken)
			)
		).toString('base64url');
		if (payload.ath !== expectedAth) return undefined;
	}
	const iatMs =
		typeof payload.iat === 'number' ? payload.iat * SECONDS_TO_MS : 0;
	if (
		payload.htm !== htm ||
		normalizeHtu(payload.htu) !== normalizeHtu(htu) ||
		iatMs === 0 ||
		Math.abs(now - iatMs) > maxAgeMs
	) {
		return undefined;
	}

	const jti = typeof payload.jti === 'string' ? payload.jti : undefined;
	if (
		jti !== undefined &&
		isUsedJti !== undefined &&
		(await isUsedJti(jti))
	) {
		return undefined;
	}

	return { jkt: await jwkThumbprint(header.jwk), jti };
};
