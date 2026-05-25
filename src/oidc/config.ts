import { MILLISECONDS_IN_A_DAY, MILLISECONDS_IN_AN_HOUR } from '../constants';
import { generateSecureToken, hashToken } from '../crypto';
import type { RouteString } from '../types';
import { signJwt, type SigningKey } from './keys';
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

	const accessPayload: Record<string, unknown> = {
		aud: clientId,
		client_id: clientId,
		exp: nowSeconds(now + accessTtl),
		iat: nowSeconds(now),
		iss: config.issuer,
		jti: crypto.randomUUID(),
		scope: scopes.join(' '),
		sub,
		token_use: 'access'
	};
	if (dpopJkt !== undefined) accessPayload.cnf = { jkt: dpopJkt };

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

// PKCE S256: code_challenge = base64url(sha256(code_verifier)) — exactly what hashToken does.
export const verifyPkce = async (codeVerifier: string, codeChallenge: string) =>
	(await hashToken(codeVerifier)) === codeChallenge;
