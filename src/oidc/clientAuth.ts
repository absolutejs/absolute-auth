// RFC 7521 / 7523 — `private_key_jwt` client authentication.
//
// Clients prove who they are by signing a JWT (the `client_assertion`) with their private
// key. We verify the assertion against the public JWKS they registered (inline `jwks` or
// fetched `jwksUri`), with these checks:
//
//   - signed by one of the client's keys (ES256 — same alg the package uses elsewhere)
//   - `iss === sub === client_id` (per RFC 7523 §3 — the client is asserting their own identity)
//   - `aud` includes our token endpoint URL
//   - `exp` is in the future + within a sane window (no decades-long assertions)
//   - `jti` not seen for this client (replay protection via the optional jti store)
//
// Stronger than `client_secret_post` because there's no shared secret to leak. Required by
// FAPI banking profiles + Microsoft Entra app registrations + Apple Business Connect.

import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { verifyJwt } from './keys';
import type { ClientAssertionJtiStore, OAuthClient } from './types';

export const CLIENT_ASSERTION_TYPE =
	'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

const MAX_ASSERTION_LIFETIME_MINUTES = 5;
const SECONDS_PER_MINUTE = 60;
const MAX_ASSERTION_LIFETIME_MS =
	MAX_ASSERTION_LIFETIME_MINUTES *
	SECONDS_PER_MINUTE *
	MILLISECONDS_IN_A_SECOND;

// Resolve the client's JWKS — inline `jwks` first, fallback to fetching `jwksUri`. The
// fetched response is cached for one minute per URI to avoid hammering the client's JWKS
// endpoint under load; longer caches are a foot-gun on key rotation. Cache is process-local.
const jwksCache = new Map<string, { fetchedAt: number; jwks: JsonWebKey[] }>();
const JWKS_CACHE_TTL_MS = SECONDS_PER_MINUTE * MILLISECONDS_IN_A_SECOND;
const JWKS_FETCH_TIMEOUT_SECONDS = 5;
const JWKS_FETCH_TIMEOUT_MS =
	JWKS_FETCH_TIMEOUT_SECONDS * MILLISECONDS_IN_A_SECOND;

const fetchJwksUri = async (jwksUri: string) => {
	const cached = jwksCache.get(jwksUri);
	if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
		return cached.jwks;
	}
	try {
		const response = await fetch(jwksUri, {
			signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS)
		});
		if (!response.ok) return undefined;
			const body: unknown = await response.json();
			if (typeof body !== 'object' || body === null) return undefined;
			const keys: unknown = Reflect.get(body, 'keys');
			if (!Array.isArray(keys)) return undefined;
			const jwks = keys.filter(
				(key): key is JsonWebKey =>
					typeof key === 'object' && key !== null
			);
			if (jwks.length !== keys.length) return undefined;
			jwksCache.set(jwksUri, { fetchedAt: Date.now(), jwks });

			return jwks;
	} catch {
		return undefined;
	}
};

const resolveClientJwks = async (client: OAuthClient) => {
	if (client.jwks && client.jwks.length > 0) return client.jwks;
	if (client.jwksUri !== undefined) return fetchJwksUri(client.jwksUri);

	return undefined;
};

// Try each candidate JWK until one verifies the assertion. Returns the decoded payload
// or `undefined`. Trying every key (rather than matching `kid`) is small + survives
// missing/wrong kids that some libraries produce.
const verifyAgainstAny = async (
	assertion: string,
	candidates: JsonWebKey[]
) => {
	for (const jwk of candidates) {
		const verified = await verifyJwt(assertion, jwk);
		if (verified !== undefined) return verified;
	}

	return undefined;
};

const verifyJwtSignedByClientImpl = async (
	client: OAuthClient,
	jwt: string
) => {
	const candidates = await resolveClientJwks(client);
	if (candidates === undefined || candidates.length === 0) return undefined;

	return verifyAgainstAny(jwt, candidates);
};

// Verify a `client_assertion` JWT presented at the token endpoint. Returns the resolved
// `OAuthClient` on success, or `undefined` if any check fails. The caller logs +
// returns `invalid_client` from the route.
export const verifyClientAssertion = async ({
	assertion,
	expectedAudience,
	jtiStore,
	resolveClient
}: {
	assertion: string;
	expectedAudience: string;
	jtiStore?: ClientAssertionJtiStore;
	resolveClient: (clientId: string) => Promise<OAuthClient | undefined>;
}) => {
	// Decode the payload speculatively (without verifying yet) so we know which client
	// to look up + which JWKS to verify against.
	const [, payloadSegment] = assertion.split('.');
	if (payloadSegment === undefined) return undefined;
	let payload: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(payloadSegment, 'base64url').toString('utf8')
		);
			if (
				typeof parsed !== 'object' ||
				parsed === null ||
				Array.isArray(parsed)
			)
				return undefined;
			payload = Object.fromEntries(
				Object.keys(parsed).map((key) => [key, Reflect.get(parsed, key)])
			);
	} catch {
		return undefined;
	}

	const {
		aud,
		exp,
		iss,
		jti,
		sub
	}: {
		aud?: unknown;
		exp?: unknown;
		iss?: unknown;
		jti?: unknown;
		sub?: unknown;
	} = payload;

	if (
		typeof iss !== 'string' ||
		typeof sub !== 'string' ||
		iss !== sub ||
		typeof exp !== 'number'
	) {
		return undefined;
	}
	const audMatches =
		(typeof aud === 'string' && aud === expectedAudience) ||
		(Array.isArray(aud) && aud.includes(expectedAudience));
	if (!audMatches) return undefined;
	const expMs = exp * MILLISECONDS_IN_A_SECOND;
	const now = Date.now();
	if (expMs <= now || expMs - now > MAX_ASSERTION_LIFETIME_MS) {
		return undefined;
	}

	const client = await resolveClient(iss);
	if (client === undefined) return undefined;
	const candidates = await resolveClientJwks(client);
	if (candidates === undefined || candidates.length === 0) return undefined;

	const verified = await verifyAgainstAny(assertion, candidates);
	if (verified === undefined) return undefined;

	if (jtiStore !== undefined) {
		if (typeof jti !== 'string') return undefined;
		const fresh = await jtiStore.recordIfFresh(client.clientId, jti, expMs);
		if (!fresh) return undefined;
	}

	return client;
};

// Verify a JWT was signed by one of the client's registered keys (inline JWKS or
// fetched JWKS URI). Returns the decoded payload on success, or `undefined`. Does
// NOT check claim semantics — that's the caller's job (different JWT shapes from the
// same client have different aud / sub / iss expectations: client_assertion vs JAR).
// Exposed so the JAR (RFC 9101) path can reuse the same JWKS infrastructure as
// `private_key_jwt` without duplicating the key-resolution + fetch cache.
export const verifyJwtSignedByClient = ({
	jwt,
	client
}: {
	client: OAuthClient;
	jwt: string;
}) => verifyJwtSignedByClientImpl(client, jwt);
