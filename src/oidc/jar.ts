// RFC 9101 — JWT-Secured Authorization Requests (JAR).
//
// The RP can sign the entire authorize parameter set as a JWT and pass it inline as
// `request=<jwt>` on `/authorize`. Verified against the same per-client JWKS used for
// `private_key_jwt` (reuses `verifyJwtSignedByClient` from clientAuth.ts), with these
// claim checks per §5:
//   - signed by one of the client's keys (ES256, same alg as everything else)
//   - `iss === client_id`
//   - `aud` includes our issuer URL (the IdP)
//   - `exp` is in the future (when present)
//
// When valid, the claims in the JWT REPLACE any query-string parameters per §6 — query
// params other than `client_id` + `request` are ignored. That's the whole point: the
// signed JWT is the source of truth, so a tampered URL can't change what's authorized.
//
// Cousin of PAR (RFC 9126, shipped 0.29.0-beta.4): JAR sends params inline as a signed
// JWT, PAR pushes them out-of-band and references via opaque request_uri. Some FAPI
// banking deployments require JAR specifically (others accept either).

import { verifyJwtSignedByClient } from './clientAuth';
import type { OAuthClient } from './types';

const MS_PER_SECOND = 1000;

export type JarParseResult =
	| { error: 'invalid_request_object'; ok: false }
	| { ok: true; params: Record<string, string> };

const numberClaim = (value: unknown) =>
	typeof value === 'number' ? value : undefined;

const stringClaim = (value: unknown) =>
	typeof value === 'string' ? value : undefined;

const arrayClaim = (value: unknown) =>
	Array.isArray(value) && value.every((entry) => typeof entry === 'string')
		? value
		: undefined;

// Decode + verify a signed request-object JWT. The caller already resolved the client
// (via `client_id` query param) so we can check the request JWT's `iss` matches. Returns
// either the param bag the caller should use in lieu of query params, or an error to
// surface to the RP.
export const parseSignedRequestObject = async ({
	client,
	expectedIssuer,
	jwt,
	now = Date.now()
}: {
	client: OAuthClient;
	expectedIssuer: string;
	jwt: string;
	now?: number;
}): Promise<JarParseResult> => {
	const verified = await verifyJwtSignedByClient({ client, jwt });
	if (verified === undefined) {
		return { error: 'invalid_request_object', ok: false };
	}
	const { payload } = verified;
	const { aud } = payload;
	const iss = stringClaim(payload.iss);
	const exp = numberClaim(payload.exp);

	// `iss` must be the client_id (the RP is asserting its own request).
	if (iss !== client.clientId) {
		return { error: 'invalid_request_object', ok: false };
	}
	// `aud` must include the IdP. JWT spec allows a string OR an array.
	const audMatches =
		(typeof aud === 'string' && aud === expectedIssuer) ||
		(arrayClaim(aud)?.includes(expectedIssuer) ?? false);
	if (!audMatches) {
		return { error: 'invalid_request_object', ok: false };
	}
	if (exp !== undefined && exp * MS_PER_SECOND <= now) {
		return { error: 'invalid_request_object', ok: false };
	}

	// Per RFC 9101 §6.1, the request JWT's claims REPLACE all OAuth params from the
	// query string (other than `request`/`request_uri`/`client_id`). Strip the JWT
	// envelope claims (iss/aud/exp/iat/nbf/jti) before returning, then keep every
	// string-valued payload entry as the param bag.
	const envelope = new Set(['aud', 'exp', 'iat', 'iss', 'jti', 'nbf']);
	const params = Object.fromEntries(
		Object.entries(payload).filter(
			(entry): entry is [string, string] =>
				typeof entry[1] === 'string' && !envelope.has(entry[0])
		)
	);

	return { ok: true, params };
};
