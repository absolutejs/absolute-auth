// RFC 9126 — Pushed Authorization Requests.
//
// The RP POSTs the full authorize parameter set to `/oauth2/par`. We validate the client +
// its redirect_uri, mint an opaque `request_uri` (`urn:ietf:params:oauth:request_uri:<token>`),
// stash the params keyed by its hash for a short TTL (default 90s), and return the URI to
// the RP. The RP then redirects the user-agent to `/authorize?client_id=<id>&request_uri=<uri>`.
// Authorize replays the stored params.
//
// Why: with vanilla `/authorize?...`, sensitive request params (scope, state, nonce,
// resource indicators, claims) traverse the user's browser as a query string — viewable
// in history, referer headers, server logs. PAR moves them off-band via direct RP→IdP
// HTTP, so the only thing the user-agent carries is an opaque reference.

import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { generateSecureToken, hashToken } from '../crypto';
import type {
	OAuthClient,
	PushedAuthorizationRequest,
	PushedAuthorizationRequestStore
} from './types';

const REQUEST_URI_BYTES = 32;
const DEFAULT_PAR_TTL_SECONDS = 90;
export const DEFAULT_PAR_TTL_MS =
	DEFAULT_PAR_TTL_SECONDS * MILLISECONDS_IN_A_SECOND;
export const REQUEST_URI_PREFIX = 'urn:ietf:params:oauth:request_uri:';

// Build the `request_uri` we hand back to the client. The token portion is
// random/unguessable so the user-agent can't forge or enumerate URIs.
const buildRequestUri = (token: string) => `${REQUEST_URI_PREFIX}${token}`;

const extractToken = (requestUri: string) => {
	if (!requestUri.startsWith(REQUEST_URI_PREFIX)) return undefined;

	return requestUri.slice(REQUEST_URI_PREFIX.length);
};

export type PushAuthorizationResult =
	| {
			body: {
				expires_in: number;
				request_uri: string;
			};
			ok: true;
	  }
	| {
			body: { error: string };
			ok: false;
			status: 400 | 401;
	  };

// Look up a previously-pushed request and return its params. Returns `undefined` if the
// URI is unknown, expired, or the `client_id` mismatch (defense against URI substitution
// across clients). Single-use via the store's `consumeRequest` semantics.
export const consumePushedRequest = async ({
	clientId,
	requestUri,
	store
}: {
	clientId: string;
	requestUri: string;
	store: PushedAuthorizationRequestStore;
}) => {
	const token = extractToken(requestUri);
	if (token === undefined) return undefined;
	const record: PushedAuthorizationRequest | undefined =
		await store.consumeRequest(await hashToken(requestUri));
	if (record === undefined) return undefined;
	if (record.clientId !== clientId) return undefined;

	return record.params;
};

// Validate + persist a PAR. The caller has already authenticated the client (via the
// regular token-endpoint auth methods — client_secret_basic/post or private_key_jwt).
export const pushAuthorizationRequest = async ({
	client,
	now = Date.now(),
	params,
	store,
	ttlMs = DEFAULT_PAR_TTL_MS
}: {
	client: OAuthClient;
	now?: number;
	params: Record<string, string>;
	store: PushedAuthorizationRequestStore;
	ttlMs?: number;
}): Promise<PushAuthorizationResult> => {
	// Redirect URI must match a registered one — same check `/authorize` does.
	if (
		typeof params.redirect_uri !== 'string' ||
		!client.redirectUris.includes(params.redirect_uri)
	) {
		return {
			body: { error: 'invalid_redirect_uri' },
			ok: false,
			status: 400
		};
	}
	// If the client presented `client_id` in the body, it must match the authenticated one.
	if (
		typeof params.client_id === 'string' &&
		params.client_id !== client.clientId
	) {
		return { body: { error: 'invalid_request' }, ok: false, status: 400 };
	}

	const token = generateSecureToken(REQUEST_URI_BYTES);
	const requestUri = buildRequestUri(token);
	const expiresAt = now + ttlMs;
	const stored: Record<string, string> = { ...params };
	// We always pin the client_id on read so /authorize can cross-check it against the
	// `client_id` query param even if the RP omitted it from the original POST.
	stored.client_id = client.clientId;

	await store.saveRequest({
		clientId: client.clientId,
		createdAt: now,
		expiresAt,
		params: stored,
		requestUriHash: await hashToken(requestUri)
	});

	return {
		body: {
			expires_in: Math.floor(ttlMs / MILLISECONDS_IN_A_SECOND),
			request_uri: requestUri
		},
		ok: true
	};
};
