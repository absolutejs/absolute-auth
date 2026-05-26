// A registered relying party — the apps that "Sign in with <yourapp>".
export type OAuthClient = {
	// OIDC back-channel logout endpoint. When present, this client receives signed
	// `logout_token` POSTs whenever a user with active refresh tokens for it signs out.
	backchannelLogoutUri?: string;
	clientId: string;
	// SHA-256 hash of the client secret. Omitted for public (PKCE-only) clients.
	hashedSecret?: string;
	// Inline JWKS for `private_key_jwt` client auth (RFC 7521/7523). The client signs a
	// `client_assertion` JWT with their private key; we verify it against one of these
	// public keys. Either this or `jwksUri` (or both) authenticates the client without
	// shared secrets — the form Microsoft Entra / Apple Business / FAPI expect.
	jwks?: JsonWebKey[];
	// URL we fetch + cache the client's JWKS from for `private_key_jwt`. Refreshed on
	// kid miss; consumers control cache TTL via the OidcProviderConfig.
	jwksUri?: string;
	name: string;
	// OIDC RP-initiated logout — the redirect targets allowed in `post_logout_redirect_uri`.
	postLogoutRedirectUris?: string[];
	redirectUris: string[];
	// FAPI-style hardening: when true, `/authorize` rejects requests that didn't go through
	// `/oauth2/par` first. Off by default — opt-in per client.
	requirePushedAuthorizationRequests?: boolean;
	scopes: string[];
};

// One-use `jti` ledger for `client_assertion` JWTs — RFC 7523 §3 requires us to reject
// replays within the assertion's validity window. Entries are short-lived (~5 min by
// default; bounded by the assertion `exp`); a cleanup pass can prune expired ones.
export type ClientAssertionJtiStore = {
	// Returns true if this is the first time we've seen this (clientId, jti) pair AND
	// records it; false if we've seen it before (replay).
	recordIfFresh: (
		clientId: string,
		jti: string,
		expiresAt: number
	) => Promise<boolean>;
};

// A Pushed Authorization Request (RFC 9126). The RP POSTs the full authorize params to
// `/oauth2/par`; we store them under an opaque `request_uri` (90s TTL) and the RP redirects
// the user to `/authorize?client_id=...&request_uri=...`. Closes the URL-shoving attack
// surface — request params never traverse the user's browser.
export type PushedAuthorizationRequest = {
	clientId: string;
	createdAt: number;
	expiresAt: number;
	// Stored param bag — exactly what the RP POSTed (minus client auth fields). Whatever
	// `/authorize` would have read from the query string, we replay from here. Typed as
	// Record<string, string> because URL-encoded form bodies are flat strings.
	params: Record<string, string>;
	requestUriHash: string;
};

export type PushedAuthorizationRequestStore = {
	consumeRequest: (
		requestUriHash: string
	) => Promise<PushedAuthorizationRequest | undefined>;
	saveRequest: (request: PushedAuthorizationRequest) => Promise<void>;
};

export type OAuthClientStore = {
	// Optional — only needed when Dynamic Client Registration (RFC 7591/7592) is enabled.
	// Without these, DCR returns 501 unsupported, and the existing static-client model
	// (pre-registered via findClient) continues to work unchanged.
	deleteClient?: (clientId: string) => Promise<void>;
	findClient: (clientId: string) => Promise<OAuthClient | undefined>;
	saveClient?: (client: OAuthClient) => Promise<void>;
	updateClient?: (clientId: string, client: OAuthClient) => Promise<void>;
};

// The credential a Dynamic Client Registration client uses to manage its own registration
// (RFC 7592). Issued at registration time, hashed at rest, rotatable on update. One per client.
export type ClientRegistrationToken = {
	clientId: string;
	createdAt: number;
	tokenHash: string;
};

export type ClientRegistrationTokenStore = {
	deleteByClientId: (clientId: string) => Promise<void>;
	findByTokenHash: (
		tokenHash: string
	) => Promise<ClientRegistrationToken | undefined>;
	saveToken: (token: ClientRegistrationToken) => Promise<void>;
};

// Optional gate on Dynamic Client Registration — when configured, the POST /oauth2/register
// caller must present a valid `initial_access_token` in the Authorization header. Lets
// operators run a closed federation (only pre-issued tokens can register clients) without
// requiring open public DCR. Tokens are opaque + consumed on use.
export type InitialAccessTokenStore = {
	consumeToken: (tokenHash: string) => Promise<boolean>;
};

// A short-lived, single-use authorization code (PKCE- and optionally DPoP-bound).
export type AuthorizationCode = {
	claims?: Record<string, unknown>;
	clientId: string;
	codeChallenge: string;
	codeHash: string;
	createdAt: number;
	dpopJkt?: string;
	expiresAt: number;
	nonce?: string;
	redirectUri: string;
	scopes: string[];
	userId: string;
};

export type AuthorizationCodeStore = {
	// Atomically fetch and delete (codes are single-use).
	consumeCode: (codeHash: string) => Promise<AuthorizationCode | undefined>;
	saveCode: (code: AuthorizationCode) => Promise<void>;
};

// A refresh token — opaque, stored by hash, rotated on every use.
export type OidcRefreshToken = {
	claims?: Record<string, unknown>;
	clientId: string;
	createdAt: number;
	dpopJkt?: string;
	expiresAt: number;
	scopes: string[];
	tokenHash: string;
	userId: string;
};

export type OidcRefreshTokenStore = {
	// Atomically fetch and delete (rotation: each refresh token is used once).
	consumeToken: (tokenHash: string) => Promise<OidcRefreshToken | undefined>;
	deleteForUser: (userId: string) => Promise<void>;
	// Non-consuming lookup — only used by the introspection endpoint (RFC 7662).
	getToken: (tokenHash: string) => Promise<OidcRefreshToken | undefined>;
	// Distinct client ids holding non-expired refresh tokens for the user. Used by
	// OIDC back-channel logout to know which RPs to push a `logout_token` to.
	listClientIdsForUser: (userId: string) => Promise<string[]>;
	saveToken: (token: OidcRefreshToken) => Promise<void>;
};

// RFC 8628 device authorization. The device polls for the access token using `device_code`;
// the user authorizes on a second-device browser by entering `user_code` at the
// `verification_uri`. `status` flips pending→approved (or denied) when the user authenticates
// + confirms; `userSub` is populated at approval time so the device can mint a user-bound token.
export type DeviceAuthorizationStatus = 'approved' | 'denied' | 'pending';

export type DeviceAuthorization = {
	clientId: string;
	createdAt: number;
	deviceCodeHash: string;
	expiresAt: number;
	intervalSeconds: number;
	scopes: string[];
	status: DeviceAuthorizationStatus;
	userCode: string;
	userSub?: string;
};

// A back-channel `logout_token` delivery the dispatcher gave up on (network error or
// non-2xx from the RP). Persisted to the optional `LogoutDeliveryStore` so consumers can
// inspect (alerting), replay, or `removeFailure(id)` once handled.
export type LogoutDelivery = {
	attempts: number;
	clientId: string;
	createdAt: number;
	endpointUrl: string;
	id: string;
	lastError?: string;
	lastStatus?: number;
	logoutToken: string;
	userId: string;
};

export type LogoutDeliveryStore = {
	listFailed: (limit?: number) => Promise<LogoutDelivery[]>;
	recordFailure: (delivery: LogoutDelivery) => Promise<void>;
	removeFailure: (deliveryId: string) => Promise<void>;
};

export type DeviceAuthorizationStore = {
	deleteByDeviceCodeHash: (deviceCodeHash: string) => Promise<void>;
	findByDeviceCodeHash: (
		deviceCodeHash: string
	) => Promise<DeviceAuthorization | undefined>;
	findByUserCode: (
		userCode: string
	) => Promise<DeviceAuthorization | undefined>;
	saveDeviceAuthorization: (
		deviceAuthorization: DeviceAuthorization
	) => Promise<void>;
	updateStatus: (
		deviceCodeHash: string,
		status: DeviceAuthorizationStatus,
		userSub?: string
	) => Promise<void>;
};
