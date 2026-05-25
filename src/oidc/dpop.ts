import { jwkThumbprint, verifyJwt } from './keys';

// DPoP (RFC 9449) — sender-constrained tokens. The client signs a per-request proof JWT with
// an ephemeral key (its public JWK is in the proof header); we verify the proof and bind the
// issued access token to the key's thumbprint (`cnf.jkt`). On resource use, the proof's
// thumbprint must match the token's `cnf.jkt` — so a stolen bearer token is useless without
// the private key. WorkOS does not offer this.

const DEFAULT_MAX_AGE_MS = 60_000;
const SECONDS_TO_MS = 1000;

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
	htm,
	htu,
	isUsedJti,
	maxAgeMs = DEFAULT_MAX_AGE_MS,
	now = Date.now(),
	proof
}: {
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
	if (jti !== undefined && isUsedJti !== undefined && (await isUsedJti(jti))) {
		return undefined;
	}

	return { jkt: await jwkThumbprint(header.jwk), jti };
};
