// OIDC `/userinfo` endpoint.
//
// The RP presents a Bearer access token; we verify it (our own signature + exp), pull
// `sub`, optionally enrich via the consumer `getUserInfo` hook, and return JSON. Spec
// always requires `sub` in the response, but the consumer decides what other claims to
// surface (email, name, etc.) — keeping us agnostic to user shape.
//
// `WWW-Authenticate: Bearer` headers on errors so RP clients can react per RFC 6750.

import { signingVerificationKeys, verifyJwtWithKeys } from './keys';
import type { OidcProviderConfig } from './config';

const BEARER_PREFIX = 'Bearer ';

const readBearer = (authorization: string | undefined) => {
	if (
		authorization === undefined ||
		!authorization.startsWith(BEARER_PREFIX)
	) {
		return undefined;
	}

	return authorization.slice(BEARER_PREFIX.length).trim();
};

export type UserInfoResult =
	| {
			body: Record<string, unknown> & { sub: string };
			ok: true;
	  }
	| {
			body: { error: string; error_description?: string };
			error: 'invalid_request' | 'invalid_token';
			ok: false;
	  };

export const readUserInfoBearer = readBearer;

export const fetchUserInfo = async <UserType>({
	config,
	now = Date.now(),
	token
}: {
	config: OidcProviderConfig<UserType>;
	now?: number;
	token: string | undefined;
}): Promise<UserInfoResult> => {
	if (token === undefined) {
		return {
			body: { error: 'invalid_request' },
			error: 'invalid_request',
			ok: false
		};
	}
	const verified = await verifyJwtWithKeys(
		token,
		signingVerificationKeys(config.signingKey, config.previousSigningKeys)
	);
	if (verified === undefined) {
		return {
			body: { error: 'invalid_token' },
			error: 'invalid_token',
			ok: false
		};
	}
	const { payload } = verified;
	if (
		typeof payload.sub !== 'string' ||
		typeof payload.exp !== 'number' ||
		payload.exp * 1000 <= now
	) {
		return {
			body: { error: 'invalid_token' },
			error: 'invalid_token',
			ok: false
		};
	}

	const enriched = await config.getUserInfo?.(payload.sub);

	return {
		body: { ...(enriched ?? {}), sub: payload.sub },
		ok: true
	};
};

// Build the WWW-Authenticate challenge header for a userinfo error per RFC 6750 §3.
// The realm is fixed; the error param identifies the failure mode to the RP.
export const userInfoChallengeHeader = (
	error: 'invalid_request' | 'invalid_token'
) => `Bearer realm="userinfo", error="${error}"`;
