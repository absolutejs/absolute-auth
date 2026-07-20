// OIDC Session Management 1.0 + Back-Channel Logout 1.0.
//
// RP-initiated logout: the RP redirects the user to `end_session_endpoint` with the
// `id_token_hint` we issued + a `post_logout_redirect_uri` registered on the client. We verify
// the hint was signed by us, clear the user's session, fan out back-channel `logout_token`
// POSTs to every other RP that holds active refresh tokens for that user, and redirect back.
//
// V1 ships sub-based "logout everywhere" semantics — the `logout_token` carries `sub` only,
// so dropping one RP session signs out every session that user has across every registered RP
// (that exposes `backchannelLogoutUri`). Per-session sid-based logout can be added later
// without breaking the API.
//
// Front-channel logout (iframe fan-out from the browser) is deliberately out of v1 — it
// requires HTML rendering with one iframe per RP, which is outside the route shape, and the
// back-channel path already covers the common "RPs need to know" use case server-side.

import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { signJwt, signingVerificationKeys, verifyJwtWithKeys } from './keys';
import type { OidcProviderConfig } from './config';
import type { LogoutDelivery, OAuthClient } from './types';

const BACKCHANNEL_LOGOUT_EVENT =
	'http://schemas.openid.net/event/backchannel-logout';

// The `logout_token` JWT per OIDC Back-Channel Logout §2.4.
const buildLogoutClaims = ({
	clientId,
	issuer,
	now,
	sub
}: {
	clientId: string;
	issuer: string;
	now: number;
	sub: string;
}) => ({
	aud: clientId,
	events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
	iat: Math.floor(now / MILLISECONDS_IN_A_SECOND),
	iss: issuer,
	jti: crypto.randomUUID(),
	sub
});

// Pick the redirect — only honor the requested URL if it's in the client's allow-list.
// Spec lets us drop the requested URL silently when it isn't registered (and just respond 200),
// but we go further and return `undefined` so the caller decides between "redirect home" vs.
// "render a 200".
export const resolvePostLogoutRedirect = ({
	client,
	requestedUri
}: {
	client: OAuthClient;
	requestedUri: string | undefined;
}) => {
	if (requestedUri === undefined) return undefined;
	const allow = client.postLogoutRedirectUris ?? [];

	return allow.includes(requestedUri) ? requestedUri : undefined;
};

// Verify an `id_token_hint` came from us. Per the spec the token may be expired (it's a
// hint, not an auth credential) — `verifyJwt` validates signature only and returns the
// decoded payload regardless of `exp`, which is exactly what we want here.
export const verifyIdTokenHint = async <UserType>({
	config,
	idTokenHint
}: {
	config: OidcProviderConfig<UserType>;
	idTokenHint: string;
}) => {
	const verified = await verifyJwtWithKeys(
		idTokenHint,
		signingVerificationKeys(config.signingKey, config.previousSigningKeys)
	);
	const payload = verified?.payload;
	if (
		payload === undefined ||
		typeof payload.sub !== 'string' ||
		typeof payload.aud !== 'string' ||
		payload.iss !== config.issuer
	) {
		return undefined;
	}

	return { audClientId: payload.aud, sub: payload.sub };
};

type DeliveryFetch = (
	url: string,
	init: {
		body: string;
		headers: Record<string, string>;
		method: string;
		signal: AbortSignal;
	}
) => Promise<{ ok: boolean; status: number }>;

const BACKCHANNEL_TIMEOUT_SECONDS = 5;
const DEFAULT_BACKCHANNEL_TIMEOUT_MS =
	BACKCHANNEL_TIMEOUT_SECONDS * MILLISECONDS_IN_A_SECOND;

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const statusFromError = (error: unknown) => {
	if (!(error instanceof Error)) return undefined;
	const match = /returned (\d+)/.exec(error.message);

	return match?.[1] === undefined ? undefined : Number(match[1]);
};

// Mint a logout_token for a (user, client) pair. Exported so consumers can rotate the
// signing key + replay the DLQ with a freshly-signed token if desired.
export const mintLogoutToken = async <UserType>({
	clientId,
	config,
	now = Date.now(),
	sub
}: {
	clientId: string;
	config: OidcProviderConfig<UserType>;
	now?: number;
	sub: string;
}) =>
	signJwt(
		buildLogoutClaims({ clientId, issuer: config.issuer, now, sub }),
		config.signingKey
	);

const postLogoutToken = async ({
	endpointUrl,
	fetchImpl,
	logoutToken,
	timeoutMs
}: {
	endpointUrl: string;
	fetchImpl: DeliveryFetch;
	logoutToken: string;
	timeoutMs: number;
}) => {
	const response = await fetchImpl(endpointUrl, {
		body: new URLSearchParams({ logout_token: logoutToken }).toString(),
		headers: {
			'content-type': 'application/x-www-form-urlencoded'
		},
		method: 'POST',
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!response.ok) {
		throw new Error(`Back-channel logout returned ${response.status}`);
	}
};

// Send a logout_token to one RP. On failure, persist to the DLQ + invoke the optional
// `onError` hook. Returns nothing — failures are swallowed so a dead RP can't block the
// outer fan-out (and can't break the user-facing redirect either).
const deliverLogoutToOne = async <UserType>({
	clientId,
	config,
	endpointUrl,
	fetchImpl,
	logoutToken,
	onError,
	timeoutMs,
	userId
}: {
	clientId: string;
	config: OidcProviderConfig<UserType>;
	endpointUrl: string;
	fetchImpl: DeliveryFetch;
	logoutToken: string;
	onError: ((delivery: LogoutDelivery) => void | Promise<void>) | undefined;
	timeoutMs: number;
	userId: string;
}) => {
	try {
		await postLogoutToken({
			endpointUrl,
			fetchImpl,
			logoutToken,
			timeoutMs
		});
	} catch (error) {
		const delivery: LogoutDelivery = {
			attempts: 1,
			clientId,
			createdAt: Date.now(),
			endpointUrl,
			id: crypto.randomUUID(),
			lastError: errorMessage(error),
			lastStatus: statusFromError(error),
			logoutToken,
			userId
		};
		await config.logoutDeliveryStore?.recordFailure(delivery);
		await onError?.(delivery);
	}
};

// Fan out a back-channel logout for `userId` to every RP with a non-expired refresh token
// AND a registered `backchannelLogoutUri`. Skips the RP that initiated the logout (it
// already knows). Returns the list of RP `clientId`s we attempted to notify.
export const fanOutBackchannelLogout = async <UserType>({
	config,
	fetchImpl = globalThis.fetch,
	now = Date.now(),
	onError,
	skipClientId,
	timeoutMs = DEFAULT_BACKCHANNEL_TIMEOUT_MS,
	userId
}: {
	config: OidcProviderConfig<UserType>;
	fetchImpl?: DeliveryFetch;
	now?: number;
	onError?: (delivery: LogoutDelivery) => void | Promise<void>;
	skipClientId?: string;
	timeoutMs?: number;
	userId: string;
}) => {
	const clientIds =
		await config.refreshTokenStore.listClientIdsForUser(userId);
	const targets = await Promise.all(
		clientIds
			.filter((clientId) => clientId !== skipClientId)
			.map(async (clientId) => {
				const client = await config.clientStore.findClient(clientId);

				return client?.backchannelLogoutUri === undefined
					? undefined
					: { client, endpointUrl: client.backchannelLogoutUri };
			})
	);
	const reachable = targets.filter(
		(target): target is { client: OAuthClient; endpointUrl: string } =>
			target !== undefined
	);

	await Promise.all(
		reachable.map(async ({ client, endpointUrl }) => {
			const logoutToken = await mintLogoutToken({
				clientId: client.clientId,
				config,
				now,
				sub: userId
			});
			await deliverLogoutToOne({
				clientId: client.clientId,
				config,
				endpointUrl,
				fetchImpl,
				logoutToken,
				onError,
				timeoutMs,
				userId
			});
		})
	);

	return reachable.map(({ client }) => client.clientId);
};
