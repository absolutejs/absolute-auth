import { MILLISECONDS_IN_A_DAY, MILLISECONDS_IN_AN_HOUR } from '../constants';
import { generateSecureToken, hashToken } from '../crypto';
import type { RouteString } from '../types';
import { signJwt, verifyJwt, type SigningKey } from './keys';
import type {
	AuthorizationCodeStore,
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
	clientStore: OAuthClientStore;
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
	loginUrl?: string;
	oidcRoute?: RouteString;
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
		token_type: dpopJkt === undefined ? 'Bearer' : 'DPoP'
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
