import {
	MILLISECONDS_IN_A_DAY,
	MILLISECONDS_IN_A_MINUTE,
	MILLISECONDS_IN_AN_HOUR
} from '../constants';
import { generateSecureToken, hashToken } from '../crypto';
import type { RouteString } from '../types';
import { signJwt, verifyJwt, type SigningKey } from './keys';
import type { OnClientRegistration } from './registration';
import type {
	AuthorizationCodeStore,
	ClientAssertionJtiStore,
	ClientRegistrationTokenStore,
	DeviceAuthorizationStore,
	InitialAccessTokenStore,
	LogoutDeliveryStore,
	OAuthClientStore,
	OidcRefreshTokenStore
} from './types';

export const DEFAULT_OIDC_ROUTE: RouteString = '/oauth2';

const MS_PER_SECOND = 1000;
const TOKEN_BYTES = 32;
const REFRESH_TTL_DAYS = 30;
const DEFAULT_ACCESS_TOKEN_TTL_MS = MILLISECONDS_IN_AN_HOUR;
const DEFAULT_ID_TOKEN_TTL_MS = MILLISECONDS_IN_AN_HOUR;
const DEFAULT_REFRESH_TOKEN_TTL_MS = MILLISECONDS_IN_A_DAY * REFRESH_TTL_DAYS;

// The OAuth2/OIDC provider — makes your app an identity provider ("Sign in with <yourapp>").
// authorization_code + mandatory PKCE, ES256 JWTs signed by a key you own (self-hosted JWKS,
// no api.workos.com), refresh-token rotation, and optional DPoP (RFC 9449) sender-constrained
// tokens. The authorize endpoint reuses the package's own session, so the IdP login gets
// passkeys / MFA / SSO for free.
export type OidcProviderConfig<UserType> = {
	accessTokenTtlMs?: number;
	authorizationCodeStore: AuthorizationCodeStore;
	// Optional — enables `private_key_jwt` client auth (RFC 7521/7523) with `jti` replay
	// protection. Without it, JWT-bearer client assertions still verify, but a leaked
	// assertion within its `exp` window can replay. Strongly recommended for production.
	clientAssertionJtiStore?: ClientAssertionJtiStore;
	// Optional — enables Dynamic Client Registration (RFC 7591/7592) at /oauth2/register
	// when paired with `clientStore.saveClient`/`updateClient`/`deleteClient`. Each issued
	// management token is persisted here (hashed) and rotates on every PUT.
	clientRegistrationTokenStore?: ClientRegistrationTokenStore;
	clientStore: OAuthClientStore;
	// Optional — enables the RFC 8628 device-authorization flow. When set, `/device_authorization`
	// + the `urn:ietf:params:oauth:grant-type:device_code` token grant are mounted, and
	// `approveDeviceAuthorization` becomes callable from your verification UI.
	deviceAuthorizationStore?: DeviceAuthorizationStore;
	deviceCodeTtlMs?: number;
	devicePollIntervalSeconds?: number;
	// Extra ACCESS token claims (per-token, after grants/exchange). Reserved keys (iss/sub/
	// aud/exp/iat/jti/client_id/scope/token_use/act/cnf) cannot be overridden.
	getAccessTokenClaims?: (context: {
		audience?: string;
		clientId: string;
		scopes: string[];
		sub: string;
	}) => Record<string, unknown> | Promise<Record<string, unknown>>;
	// Extra id_token claims for a user (email, name, …).
	getClaims?: (user: UserType) => Record<string, unknown>;
	// Consent hook: narrow the requested scopes to what the user has granted (you own the
	// consent UI / stored grants). Return undefined to deny. Omitted ⇒ auto-grant the
	// requested ∩ client scopes (fine for first-party clients).
	getGrantedScopes?: (context: {
		client: { clientId: string; name: string };
		requestedScopes: string[];
		user: UserType;
	}) => string[] | undefined | Promise<string[] | undefined>;
	// The stable subject id for a user (goes in `sub`).
	getUserId: (user: UserType) => string;
	idTokenTtlMs?: number;
	// The issuer URL, e.g. https://app.example.com (also the `iss` claim).
	issuer: string;
	// Where to send an unauthenticated authorize request (your login page). The original
	// authorize URL is appended as `?return_to=`.
	// Optional — when set, the DCR endpoint requires a valid `initial_access_token` in
	// the Authorization header before a new client can register. Lets operators run a
	// closed federation (only pre-issued tokens can register) without disabling DCR.
	initialAccessTokenStore?: InitialAccessTokenStore;
	loginUrl?: string;
	// OIDC RP-initiated + back-channel logout. When set, `/oauth2/end_session` is mounted
	// and clients with `backchannelLogoutUri` receive signed `logout_token` POSTs on
	// session end. Failed pushes are persisted here as a DLQ for inspection/replay.
	logoutDeliveryStore?: LogoutDeliveryStore;
	oidcRoute?: RouteString;
	// Optional policy hook — allow / deny / transform DCR metadata before it lands in
	// the client store. Without it, every well-formed registration is accepted (subject
	// to the `initialAccessTokenStore` gate if configured).
	onClientRegistration?: OnClientRegistration;
	refreshTokenStore: OidcRefreshTokenStore;
	refreshTokenTtlMs?: number;
	signingKey: SigningKey;
};

const nowSeconds = (milliseconds: number) =>
	Math.floor(milliseconds / MS_PER_SECOND);

const narrowScopes = (available: string[], requested?: string[]) =>
	requested === undefined || requested.length === 0
		? available
		: requested.filter((scope) => available.includes(scope));

const RESERVED_ACCESS_CLAIMS = new Set([
	'act',
	'aud',
	'client_id',
	'cnf',
	'exp',
	'iat',
	'iss',
	'jti',
	'scope',
	'sub',
	'token_use'
]);

// Access-token claims, shared by the standard grants and token exchange. `audience` (RFC 8707
// resource indicator) overrides the default `aud`; `act` records a delegation chain (RFC
// 8693); `cnf.jkt` binds the token to a DPoP key. `extraClaims` is the consumer-supplied
// addition from `getAccessTokenClaims` — reserved keys are stripped before merging so the
// hook can't accidentally rewrite the token's identity / lifetime / binding.
const buildAccessClaims = ({
	act,
	audience,
	clientId,
	dpopJkt,
	extraClaims,
	issuer,
	now,
	scopes,
	sub,
	ttl
}: {
	act?: { sub: string };
	audience?: string;
	clientId: string;
	dpopJkt?: string;
	extraClaims?: Record<string, unknown>;
	issuer: string;
	now: number;
	scopes: string[];
	sub: string;
	ttl: number;
}) => {
	const safeExtra =
		extraClaims === undefined
			? {}
			: Object.fromEntries(
					Object.entries(extraClaims).filter(
						([key]) => !RESERVED_ACCESS_CLAIMS.has(key)
					)
				);
	const claims: Record<string, unknown> = {
		...safeExtra,
		aud: audience ?? clientId,
		client_id: clientId,
		exp: nowSeconds(now + ttl),
		iat: nowSeconds(now),
		iss: issuer,
		jti: crypto.randomUUID(),
		scope: scopes.join(' '),
		sub,
		token_use: 'access'
	};
	if (act !== undefined) claims.act = act;
	if (dpopJkt !== undefined) claims.cnf = { jkt: dpopJkt };

	return claims;
};

// RFC 8693 token exchange — the AI-agent / MCP "on-behalf-of" grant. An agent (the
// authenticated client) trades a user's access token for a narrower, short-lived,
// audience-bound token whose `act` claim records the delegation, so a stolen agent token is
// scoped to one resource and can't impersonate the user broadly.
export type TokenExchangeResult =
	| { error: 'invalid_grant' | 'invalid_scope'; ok: false }
	| { accessToken: string; expiresIn: number; ok: true; scope: string };

export const exchangeToken = async <UserType>({
	actorClientId,
	audience,
	config,
	dpopJkt,
	now = Date.now(),
	requestedScopes,
	subjectToken
}: {
	actorClientId: string;
	audience?: string;
	config: OidcProviderConfig<UserType>;
	dpopJkt?: string;
	now?: number;
	requestedScopes?: string[];
	subjectToken: string;
}): Promise<TokenExchangeResult> => {
	const verified = await verifyJwt(subjectToken, config.signingKey.publicJwk);
	const payload = verified?.payload;
	if (
		payload === undefined ||
		typeof payload.sub !== 'string' ||
		typeof payload.exp !== 'number' ||
		payload.exp <= nowSeconds(now)
	) {
		return { error: 'invalid_grant', ok: false };
	}

	const available =
		typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
	if (requestedScopes?.some((scope) => !available.includes(scope)) === true) {
		return { error: 'invalid_scope', ok: false };
	}
	const scopes = narrowScopes(available, requestedScopes);
	const ttl = config.accessTokenTtlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS;
	const extraClaims = await config.getAccessTokenClaims?.({
		audience,
		clientId: actorClientId,
		scopes,
		sub: payload.sub
	});

	return {
		accessToken: await signJwt(
			buildAccessClaims({
				act: { sub: actorClientId },
				audience,
				clientId: actorClientId,
				dpopJkt,
				extraClaims,
				issuer: config.issuer,
				now,
				scopes,
				sub: payload.sub,
				ttl
			}),
			config.signingKey
		),
		expiresIn: Math.floor(ttl / MS_PER_SECOND),
		ok: true,
		scope: scopes.join(' ')
	};
};

// Mint an access token (JWT), id_token (JWT), and a rotating refresh token for a grant. When
// `dpopJkt` is set, the access token is bound to it via `cnf.jkt` and typed `DPoP`.
export const issueTokenSet = async <UserType>({
	claims,
	clientId,
	config,
	dpopJkt,
	nonce,
	now = Date.now(),
	scopes,
	sub
}: {
	claims?: Record<string, unknown>;
	clientId: string;
	config: OidcProviderConfig<UserType>;
	dpopJkt?: string;
	nonce?: string;
	now?: number;
	scopes: string[];
	sub: string;
}) => {
	const accessTtl = config.accessTokenTtlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS;
	const idTtl = config.idTokenTtlMs ?? DEFAULT_ID_TOKEN_TTL_MS;
	const refreshTtl = config.refreshTokenTtlMs ?? DEFAULT_REFRESH_TOKEN_TTL_MS;
	const accessExtra = await config.getAccessTokenClaims?.({
		clientId,
		scopes,
		sub
	});

	const accessPayload = buildAccessClaims({
		clientId,
		dpopJkt,
		extraClaims: accessExtra,
		issuer: config.issuer,
		now,
		scopes,
		sub,
		ttl: accessTtl
	});

	const idPayload: Record<string, unknown> = {
		...claims,
		aud: clientId,
		exp: nowSeconds(now + idTtl),
		iat: nowSeconds(now),
		iss: config.issuer,
		sub
	};
	if (nonce !== undefined) idPayload.nonce = nonce;

	const refreshToken = generateSecureToken(TOKEN_BYTES);
	await config.refreshTokenStore.saveToken({
		claims,
		clientId,
		createdAt: now,
		dpopJkt,
		expiresAt: now + refreshTtl,
		scopes,
		tokenHash: await hashToken(refreshToken),
		userId: sub
	});

	return {
		access_token: await signJwt(accessPayload, config.signingKey),
		expires_in: Math.floor(accessTtl / MS_PER_SECOND),
		id_token: await signJwt(idPayload, config.signingKey),
		refresh_token: refreshToken,
		scope: scopes.join(' '),
		token_type:
			dpopJkt === undefined ? ('Bearer' as const) : ('DPoP' as const)
	};
};

// MCP / RFC 9728 protected-resource metadata. Serve this from your resource (MCP) server at
// `/.well-known/oauth-protected-resource` so agent clients discover this authorization server.
export const mcpProtectedResourceMetadata = ({
	issuer,
	resource,
	scopes
}: {
	issuer: string;
	resource: string;
	scopes?: string[];
}) => ({
	authorization_servers: [issuer],
	resource,
	scopes_supported: scopes ?? []
});

// PKCE S256: code_challenge = base64url(sha256(code_verifier)) — exactly what hashToken does.
export const verifyPkce = async (codeVerifier: string, codeChallenge: string) =>
	(await hashToken(codeVerifier)) === codeChallenge;

// RFC 7662 token introspection. Returns the active/inactive status + safe-to-share claims.
// Tries the access-token path first (verify JWT signature + exp) unless the hint says refresh;
// then the refresh path (lookup by hash without consuming). `active: false` for any unknown,
// expired, or signature-invalid token — never leaks why.
export type TokenIntrospection =
	| { active: false }
	| {
			active: true;
			client_id: string;
			exp: number;
			iat: number;
			scope: string;
			sub: string;
			token_type: 'access_token' | 'refresh_token';
	  };

export type TokenTypeHint = 'access_token' | 'refresh_token';

const inactive: TokenIntrospection = { active: false };

export const introspectToken = async <UserType>({
	config,
	hint,
	now = Date.now(),
	token
}: {
	config: OidcProviderConfig<UserType>;
	hint?: TokenTypeHint;
	now?: number;
	token: string;
}) => {
	if (hint !== 'refresh_token') {
		const verified = await verifyJwt(token, config.signingKey.publicJwk);
		const payload = verified?.payload;
		if (
			payload !== undefined &&
			typeof payload.sub === 'string' &&
			typeof payload.exp === 'number' &&
			payload.exp > nowSeconds(now)
		) {
			return {
				active: true,
				client_id:
					typeof payload.client_id === 'string'
						? payload.client_id
						: '',
				exp: payload.exp,
				iat: typeof payload.iat === 'number' ? payload.iat : 0,
				scope:
					typeof payload.scope === 'string' ? payload.scope : '',
				sub: payload.sub,
				token_type: 'access_token'
			} satisfies TokenIntrospection;
		}
	}
	if (hint !== 'access_token') {
		const refresh = await config.refreshTokenStore.getToken(
			await hashToken(token)
		);
		if (refresh && refresh.expiresAt > now) {
			return {
				active: true,
				client_id: refresh.clientId,
				exp: nowSeconds(refresh.expiresAt),
				iat: nowSeconds(refresh.createdAt),
				scope: refresh.scopes.join(' '),
				sub: refresh.userId,
				token_type: 'refresh_token'
			} satisfies TokenIntrospection;
		}
	}

	return inactive;
};

// RFC 7009 token revocation — refresh tokens only. Access tokens are stateless JWTs and the
// spec allows the server to return 200 without actually revoking (the wait-for-expiry model);
// this matches Google's `/revoke` behavior. Returns whether the refresh was found + deleted.
export const revokeRefreshToken = async <UserType>(
	config: OidcProviderConfig<UserType>,
	token: string
) => {
	const consumed = await config.refreshTokenStore.consumeToken(
		await hashToken(token)
	);

	return consumed !== undefined;
};

// RFC 8628 device authorization. Devices without a browser (CLI, TVs, IoT) call this to start
// the flow; the response carries the codes + the URL the user enters on a second-device
// browser. The verification UI is consumer-built — it calls `approveDeviceAuthorization` once
// the user has authenticated + confirmed the displayed user_code matches.
const DEVICE_CODE_BYTES = 32;
const USER_CODE_HALF_LENGTH = 4;
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789';
// 15 minutes — long enough that a user can finish typing on a second device,
// short enough that an abandoned device flow doesn't linger as an attack window.
const DEFAULT_DEVICE_CODE_TTL_MINUTES = 15;
const DEFAULT_DEVICE_CODE_TTL_MS =
	MILLISECONDS_IN_A_MINUTE * DEFAULT_DEVICE_CODE_TTL_MINUTES;
const DEFAULT_DEVICE_POLL_INTERVAL_SECONDS = 5;

const generateUserCode = () => {
	const length = USER_CODE_HALF_LENGTH * 2;
	const random = crypto.getRandomValues(new Uint8Array(length));
	let code = '';
	for (const byte of random) {
		code += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
	}

	return `${code.slice(0, USER_CODE_HALF_LENGTH)}-${code.slice(USER_CODE_HALF_LENGTH)}`;
};

export type DeviceAuthorizationResponse = {
	device_code: string;
	expires_in: number;
	interval: number;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
};

export const issueDeviceAuthorization = async <UserType>({
	clientId,
	config,
	now = Date.now(),
	requestedScopes
}: {
	clientId: string;
	config: OidcProviderConfig<UserType>;
	now?: number;
	requestedScopes: string[];
}): Promise<DeviceAuthorizationResponse> => {
	if (!config.deviceAuthorizationStore) {
		throw new Error(
			'oidc.deviceAuthorizationStore is not configured — cannot start a device flow'
		);
	}
	const deviceCode = generateSecureToken(DEVICE_CODE_BYTES);
	const userCode = generateUserCode();
	const ttl = config.deviceCodeTtlMs ?? DEFAULT_DEVICE_CODE_TTL_MS;
	const interval =
		config.devicePollIntervalSeconds ?? DEFAULT_DEVICE_POLL_INTERVAL_SECONDS;
	await config.deviceAuthorizationStore.saveDeviceAuthorization({
		clientId,
		createdAt: now,
		deviceCodeHash: await hashToken(deviceCode),
		expiresAt: now + ttl,
		intervalSeconds: interval,
		scopes: requestedScopes,
		status: 'pending',
		userCode
	});
	const verificationUri = `${config.issuer}${config.oidcRoute ?? DEFAULT_OIDC_ROUTE}/device`;

	return {
		device_code: deviceCode,
		expires_in: Math.floor(ttl / MS_PER_SECOND),
		interval,
		user_code: userCode,
		verification_uri: verificationUri,
		verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`
	};
};

export type DeviceDecisionResult =
	| {
			error:
				| 'already_decided'
				| 'expired_token'
				| 'invalid_user_code'
				| 'not_configured';
			ok: false;
	  }
	| { ok: true };

const decideDeviceAuthorization = async <UserType>(
	config: OidcProviderConfig<UserType>,
	userCode: string,
	approval: { status: 'approved' | 'denied'; userSub?: string }
): Promise<DeviceDecisionResult> => {
	if (!config.deviceAuthorizationStore) {
		return { error: 'not_configured', ok: false };
	}
	const record =
		await config.deviceAuthorizationStore.findByUserCode(userCode);
	if (!record) return { error: 'invalid_user_code', ok: false };
	if (record.expiresAt < Date.now()) {
		return { error: 'expired_token', ok: false };
	}
	if (record.status !== 'pending') {
		return { error: 'already_decided', ok: false };
	}
	await config.deviceAuthorizationStore.updateStatus(
		record.deviceCodeHash,
		approval.status,
		approval.userSub
	);

	return { ok: true };
};

export const approveDeviceAuthorization = async <UserType>({
	config,
	userCode,
	userSub
}: {
	config: OidcProviderConfig<UserType>;
	userCode: string;
	userSub: string;
}) =>
	decideDeviceAuthorization(config, userCode, {
		status: 'approved',
		userSub
	});

export const denyDeviceAuthorization = async <UserType>({
	config,
	userCode
}: {
	config: OidcProviderConfig<UserType>;
	userCode: string;
}) => decideDeviceAuthorization(config, userCode, { status: 'denied' });

export type DeviceCodeExchangeError =
	| 'access_denied'
	| 'authorization_pending'
	| 'expired_token'
	| 'invalid_grant'
	| 'slow_down';

export type DeviceCodeExchangeResult =
	| {
			access_token: string;
			expires_in: number;
			id_token: string;
			ok: true;
			refresh_token: string;
			scope: string;
			token_type: 'Bearer' | 'DPoP';
	  }
	| { error: DeviceCodeExchangeError; ok: false };

export const exchangeDeviceCode = async <UserType>({
	clientId,
	config,
	deviceCode,
	dpopJkt,
	now = Date.now()
}: {
	clientId: string;
	config: OidcProviderConfig<UserType>;
	deviceCode: string;
	dpopJkt?: string;
	now?: number;
}): Promise<DeviceCodeExchangeResult> => {
	if (!config.deviceAuthorizationStore) {
		return { error: 'invalid_grant', ok: false };
	}
	const deviceCodeHash = await hashToken(deviceCode);
	const record =
		await config.deviceAuthorizationStore.findByDeviceCodeHash(
			deviceCodeHash
		);
	if (!record || record.clientId !== clientId) {
		return { error: 'invalid_grant', ok: false };
	}
	if (record.expiresAt < now) {
		await config.deviceAuthorizationStore.deleteByDeviceCodeHash(
			deviceCodeHash
		);

		return { error: 'expired_token', ok: false };
	}
	if (record.status === 'pending') {
		return { error: 'authorization_pending', ok: false };
	}
	if (record.status === 'denied' || record.userSub === undefined) {
		return { error: 'access_denied', ok: false };
	}

	// Single-use: drop the record before minting so a replay can't double-issue.
	await config.deviceAuthorizationStore.deleteByDeviceCodeHash(deviceCodeHash);
	const tokenSet = await issueTokenSet({
		clientId,
		config,
		dpopJkt,
		now,
		scopes: record.scopes,
		sub: record.userSub
	});

	return { ...tokenSet, ok: true };
};
