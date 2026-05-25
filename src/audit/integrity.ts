import type { AuditEvent, AuditSink } from './types';

// Tamper-evidence for the audit log — something WorkOS's audit product doesn't offer.
// Each event is hash-chained to the one before it: hash = H(previousHash + canonical(event)),
// using HMAC-SHA256 when a `secret` is configured (so an attacker who can write rows still
// can't forge the chain) or SHA-256 otherwise. The link is stored under
// `metadata.__integrity`, so it round-trips through any existing sink (the Postgres sink's
// jsonb column) with no schema change. `verifyAuditChain` then detects any modified, removed,
// or reordered event.

const INTEGRITY_KEY = '__integrity';
const GENESIS = '';
const HEX_RADIX = 16;
const HEX_PAD = 2;

const encoder = new TextEncoder();

export type AuditIntegrity = {
	hash: string;
	previousHash: string;
};

export type AuditChainResult = {
	brokenAt?: number;
	ok: boolean;
};

const toHex = (buffer: ArrayBuffer) =>
	[...new Uint8Array(buffer)]
		.map((byte) => byte.toString(HEX_RADIX).padStart(HEX_PAD, '0'))
		.join('');

const sha256Hex = async (message: string) =>
	toHex(await crypto.subtle.digest('SHA-256', encoder.encode(message)));

const hmacSha256Hex = async (secret: string, message: string) => {
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ hash: 'SHA-256', name: 'HMAC' },
		false,
		['sign']
	);

	return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
};

const sortKeys = (value: unknown) =>
	value === null || typeof value !== 'object' || Array.isArray(value)
		? value
		: Object.fromEntries(
				Object.entries(value).sort((left, right) =>
					left[0].localeCompare(right[0])
				)
			);

// Deterministic JSON: every object's keys sorted (via the replacer, so JSON.stringify does
// the recursion) — stable even after a jsonb round-trip reorders keys.
const stableStringify = (value: unknown) =>
	JSON.stringify(value, (_key, val) => sortKeys(val));

const cleanMetadata = (metadata?: Record<string, unknown>) => {
	if (metadata === undefined) return undefined;
	const result: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(metadata)) {
		if (key !== INTEGRITY_KEY) result[key] = val;
	}

	// Collapse to undefined when nothing but the integrity link remains, so an event that
	// originally had no metadata hashes identically before and after the link is added.
	return Object.keys(result).length === 0 ? undefined : result;
};

const readIntegrity = (event: AuditEvent) => {
	const raw = event.metadata?.[INTEGRITY_KEY];
	if (raw === undefined) return undefined;

	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- deserialization boundary: this shape was written by createTamperEvidentSink
	return raw as AuditIntegrity;
};

const brokenAt = (index: number) => {
	const result: AuditChainResult = { brokenAt: index, ok: false };

	return result;
};

// Wrap any AuditSink so every appended event is hash-chained. The previous hash is seeded
// lazily from the sink's most recent event (so the chain survives restarts). Assumes a
// single append writer per sink; for multi-writer setups, shard one chained sink per writer.
export const createTamperEvidentSink = ({
	secret,
	sink
}: {
	secret?: string;
	sink: AuditSink;
}): AuditSink => {
	let lastHash: string | undefined;

	const seed = async () => {
		if (lastHash !== undefined) return;
		const [recent] = (await sink.list?.({ limit: 1 })) ?? [];
		lastHash = recent ? (readIntegrity(recent)?.hash ?? GENESIS) : GENESIS;
	};

	return {
		list: sink.list,
		append: async (event) => {
			await seed();
			const previousHash = lastHash ?? GENESIS;
			const hash = await hashAuditEvent(event, previousHash, secret);
			lastHash = hash;
			const integrity: AuditIntegrity = { hash, previousHash };
			await sink.append({
				...event,
				metadata: { ...event.metadata, [INTEGRITY_KEY]: integrity }
			});
		}
	};
};

// Hash an event into the chain. Excludes the integrity link itself so verification is stable.
export const hashAuditEvent = async (
	event: AuditEvent,
	previousHash: string,
	secret?: string
) => {
	const message = `${previousHash}.${stableStringify({
		...event,
		metadata: cleanMetadata(event.metadata)
	})}`;

	return secret === undefined
		? sha256Hex(message)
		: hmacSha256Hex(secret, message);
};

// Verify a hash-chained log. Pass events oldest-first. Returns ok, or the index of the first
// event whose link is missing, altered, or out of order.
export const verifyAuditChain = async (
	events: AuditEvent[],
	secret?: string
) => {
	let previousHash = GENESIS;
	for (let index = 0; index < events.length; index += 1) {
		const event = events[index];
		if (event === undefined) return brokenAt(index);
		const integrity = readIntegrity(event);
		// eslint-disable-next-line no-await-in-loop -- chain verification is inherently sequential
		const expected = await hashAuditEvent(event, previousHash, secret);
		if (
			integrity === undefined ||
			integrity.previousHash !== previousHash ||
			integrity.hash !== expected
		) {
			return brokenAt(index);
		}
		previousHash = integrity.hash;
	}
	const valid: AuditChainResult = { ok: true };

	return valid;
};
