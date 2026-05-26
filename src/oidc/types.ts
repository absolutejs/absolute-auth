// A registered relying party — the apps that "Sign in with <yourapp>".
export type OAuthClient = {
	clientId: string;
	// SHA-256 hash of the client secret. Omitted for public (PKCE-only) clients.
	hashedSecret?: string;
	name: string;
	redirectUris: string[];
	scopes: string[];
};

export type OAuthClientStore = {
	findClient: (clientId: string) => Promise<OAuthClient | undefined>;
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
