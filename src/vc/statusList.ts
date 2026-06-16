// Bitstring Status List (draft-ietf-oauth-status-list-12). The revocation mechanism that
// every VC ecosystem needs: the issuer publishes a JWT-encoded bitmap, each credential is
// assigned an `idx` into one list, and the verifier checks the bit at issue/verify time.
//
// `0` = valid, `1` = revoked (1-bit status; the spec also allows 2/4/8-bit for richer state
// like "suspended", but 1-bit is what every wallet implements first and 99% of consumers
// need).
//
// Storage shape: a typed `Uint8Array` of `size / 8` bytes. The package owns the bit math
// + JWT signing; the consumer owns the byte array's persistence (in-mem map, Postgres row,
// Redis blob — whatever fits their durability needs).
//
// One status list is a published JWT served from a stable URL; the credential references
// it via the `status.status_list = { idx, uri }` claim. The verifier fetches the JWT,
// verifies the signature, decodes the bitmap, reads the bit at `idx`.

import { signJwt, verifyJwt, type SigningKey } from '../oidc/keys';

const STATUS_LIST_TYP = 'statuslist+jwt';
const STATUS_LIST_SUB_TYP = 'application/statuslist+jwt';
const DEFAULT_LIST_SIZE = 131_072; // 16 KiB of bits = 16,384 bytes — enough for many issuers
const BITS_PER_BYTE = 8;
const MS_PER_SECOND = 1000;
const BYTE_MASK = 0xff;

export type StatusListBits = Uint8Array;

// Build a fresh, all-zero status list (every credential valid). Size in bits; defaults to
// 131,072 (≈16 KiB serialized) which is a comfortable starting size — resize by creating a
// new list with a new `listId` when you outgrow it.
export const createStatusList = (size: number = DEFAULT_LIST_SIZE) => {
	if (size % BITS_PER_BYTE !== 0) {
		throw new Error('Status list size must be a multiple of 8');
	}

	return new Uint8Array(size / BITS_PER_BYTE);
};
export const getCredentialStatus = (bits: StatusListBits, idx: number) => {
	const byteIndex = Math.floor(idx / BITS_PER_BYTE);
	const bitIndex = idx % BITS_PER_BYTE;
	if (byteIndex >= bits.length) return undefined;
	const byte = bits[byteIndex] ?? 0;

	return ((byte >> bitIndex) & 1) === 1 ? 1 : 0;
};
export const setCredentialStatus = (
	bits: StatusListBits,
	idx: number,
	value: 0 | 1
) => {
	const byteIndex = Math.floor(idx / BITS_PER_BYTE);
	const bitIndex = idx % BITS_PER_BYTE;
	if (byteIndex >= bits.length) {
		throw new Error(`Status idx ${idx} out of range for this list`);
	}
	const current = bits[byteIndex] ?? 0;
	const mask = 1 << bitIndex;
	const next = value === 1 ? current | mask : current & (BYTE_MASK ^ mask);
	bits[byteIndex] = next;

	return bits;
};

// Spec §4: status lists are published as compressed bitmaps inside a signed JWT. The
// compressed bytes go in the `lst` claim as base64url. We use DEFLATE because every
// runtime ships it (gzip without the 10-byte gzip header).
const compress = async (bits: Uint8Array) => {
	// Blob accepts BufferSource; Uint8Array satisfies that structurally. The lib.d.ts
	// typings list BlobPart explicitly but `bits` is already assignable — copy into a
	// fresh Uint8Array so the Blob constructor accepts it without an assertion.
	const blob = new Blob([new Uint8Array(bits)]);
	const stream = new Response(
		blob.stream().pipeThrough(new CompressionStream('deflate'))
	);
	const compressed = new Uint8Array(await stream.arrayBuffer());

	return Buffer.from(compressed).toString('base64url');
};

const decompress = async (encoded: string) => {
	const compressed = Buffer.from(encoded, 'base64url');
	const blob = new Blob([new Uint8Array(compressed)]);
	const stream = new Response(
		blob.stream().pipeThrough(new DecompressionStream('deflate'))
	);

	return new Uint8Array(await stream.arrayBuffer());
};

const nowSeconds = (timeMs: number) => Math.floor(timeMs / MS_PER_SECOND);

// Sign a status list as a JWT for publication. The wire format `header.typ === 'statuslist+jwt'`
// is what verifiers look for before trusting the `status_list.lst` claim.
export const buildStatusClaim = (idx: number, uri: string) => ({
	status_list: { idx, uri }
});
export const signStatusList = async ({
	bits,
	issuer,
	listUri,
	now = Date.now(),
	signingKey,
	ttlSeconds
}: {
	bits: StatusListBits;
	issuer: string;
	listUri: string;
	now?: number;
	signingKey: SigningKey;
	ttlSeconds?: number;
}) => {
	const payload: Record<string, unknown> = {
		iat: nowSeconds(now),
		iss: issuer,
		status_list: {
			bits: 1,
			lst: await compress(bits)
		},
		sub: listUri,
		ttl: ttlSeconds
	};
	if (ttlSeconds !== undefined) {
		payload.exp = nowSeconds(now) + ttlSeconds;
	}

	return signJwt(payload, signingKey);
};
export const verifyStatusListJwt = async ({
	issuerPublicJwk,
	token
}: {
	issuerPublicJwk: JsonWebKey;
	token: string;
}) => {
	const decoded = await verifyJwt(token, issuerPublicJwk);
	if (decoded === undefined) return undefined;
	const rawPayload = decoded.payload;
	if (typeof rawPayload !== 'object' || rawPayload === null) return undefined;
	const payload: { [key: string]: unknown } = { ...rawPayload };
	const statusList = payload.status_list;
	if (typeof statusList !== 'object' || statusList === null) return undefined;
	const lst = Reflect.get(statusList, 'lst');
	const bitsPerEntry = Reflect.get(statusList, 'bits');
	if (typeof lst !== 'string') return undefined;
	if (bitsPerEntry !== undefined && bitsPerEntry !== 1) {
		// Multi-bit status not supported in this slice — verifier should treat as unknown.
		return undefined;
	}
	const bits = await decompress(lst);

	return {
		bits,
		sub: typeof payload.sub === 'string' ? payload.sub : undefined
	};
};

export { STATUS_LIST_SUB_TYP, STATUS_LIST_TYP };
