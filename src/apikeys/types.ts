// A static, long-lived API key (`sk_…`). Only the SHA-256 hash is stored; the
// plaintext is shown once at creation. Presented as `Authorization: Bearer …` or
// the `X-API-Key` header. `prefix` keeps the leading characters for display in a
// management UI (the rest of the key is never recoverable).
export type ApiKey = {
	createdAt: number;
	expiresAt?: number;
	hashedKey: string;
	keyId: string;
	lastUsedAt?: number;
	name: string;
	ownerId?: string;
	prefix: string;
	scopes: string[];
};

export type ApiKeyStore = {
	deleteKey: (keyId: string) => Promise<void>;
	findByHashedKey: (hashedKey: string) => Promise<ApiKey | undefined>;
	listKeys: (ownerId?: string) => Promise<ApiKey[]>;
	saveKey: (key: ApiKey) => Promise<void>;
	touchKey: (keyId: string, lastUsedAt: number) => Promise<void>;
};

// An OAuth2 client for the client_credentials (machine-to-machine) grant. Only
// the SHA-256 hash of the secret is stored; the secret is shown once at creation.
export type ApiClient = {
	clientId: string;
	createdAt: number;
	hashedSecret: string;
	name: string;
	ownerId?: string;
	scopes: string[];
};

export type ApiClientStore = {
	deleteClient: (clientId: string) => Promise<void>;
	findClient: (clientId: string) => Promise<ApiClient | undefined>;
	listClients: (ownerId?: string) => Promise<ApiClient[]>;
	saveClient: (client: ApiClient) => Promise<void>;
};

// A short-lived access token minted by the client_credentials grant. Opaque
// (`at_…`) and stored by hash — validated by lookup + expiry so it stays
// revocable (unlike a self-contained JWT).
export type AccessToken = {
	clientId: string;
	createdAt: number;
	expiresAt: number;
	hashedToken: string;
	ownerId?: string;
	scopes: string[];
	tokenId: string;
};

export type AccessTokenStore = {
	deleteExpired: (now: number) => Promise<void>;
	deleteToken: (tokenId: string) => Promise<void>;
	findByHashedToken: (hashedToken: string) => Promise<AccessToken | undefined>;
	saveToken: (token: AccessToken) => Promise<void>;
};

// The authenticated machine principal resolved from an incoming request,
// regardless of whether it presented a static API key or a client_credentials
// access token. `id` is the keyId or clientId; `ownerId` is whatever the consumer
// bound the credential to (a user id, an org id, …).
export type ApiPrincipal = {
	id: string;
	kind: 'access_token' | 'api_key';
	ownerId?: string;
	scopes: string[];
};
