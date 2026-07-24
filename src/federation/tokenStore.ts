// Federated identity token storage — Auth0's "Token Vault" pattern, self-hosted.
//
// When a user signs in with Google, they grant your app a Google access token (and
// usually a refresh token). The app needs those to call Gmail/Calendar/Drive on the
// user's behalf later. Storing them in the session cookie isn't durable across logins;
// storing them plaintext in your DB is a breach waiting to happen.
//
// This block layers a typed `{provider → tokens}` API on top of the existing `Vault`
// (which already gives you encrypted-at-rest blobs per ownerId+name). Same encryption
// + key-rotation story as everything else in the vault block.
//
// Wire `save(userId, provider, tokens)` from your `onCallbackSuccess`; call `getOrRefresh`
// when you need a fresh access token for a Gmail/Slack/etc. API call. `delete` on user
// disconnect (revokes upstream too if you pass a `revoke` callback).

import type { Vault } from '../vault/config';

const VAULT_NAME_PREFIX = 'federated:';
const REFRESH_EARLY_WINDOW_MS = 30_000; // refresh 30s before the actual expiry

export type FederatedTokenSet = {
	accessToken: string;
	expiresAt?: number;
	refreshToken?: string;
	scopes?: string[];
	storedAt: number;
	tokenType?: string;
};

const nameFor = (provider: string) => `${VAULT_NAME_PREFIX}${provider}`;

const parse = (raw: string | undefined) => {
	if (raw === undefined) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const accessToken: unknown = Reflect.get(parsed, 'accessToken');
    const expiresAt: unknown = Reflect.get(parsed, 'expiresAt');
    const refreshToken: unknown = Reflect.get(parsed, 'refreshToken');
    const scopes: unknown = Reflect.get(parsed, 'scopes');
    const storedAt: unknown = Reflect.get(parsed, 'storedAt');
    const tokenType: unknown = Reflect.get(parsed, 'tokenType');
    if (
      typeof accessToken !== 'string' ||
      typeof storedAt !== 'number' ||
      (expiresAt !== undefined && typeof expiresAt !== 'number') ||
      (refreshToken !== undefined && typeof refreshToken !== 'string') ||
      (tokenType !== undefined && typeof tokenType !== 'string') ||
      (scopes !== undefined &&
        (!Array.isArray(scopes) ||
          !scopes.every((scope) => typeof scope === 'string')))
    )
      return undefined;

    return {
      accessToken,
      expiresAt,
      refreshToken,
      scopes,
      storedAt,
      tokenType
    } satisfies FederatedTokenSet;
	} catch {
		return undefined;
	}
};

export type FederatedTokenStore = {
	delete: (
		userId: string,
		provider: string,
		revoke?: (tokens: FederatedTokenSet) => Promise<void>
	) => Promise<void>;
	get: (
		userId: string,
		provider: string
	) => Promise<FederatedTokenSet | undefined>;
	list: (userId: string) => Promise<string[]>;
	save: (
		userId: string,
		provider: string,
		tokens: Omit<FederatedTokenSet, 'storedAt'>
	) => Promise<void>;
};

export const createFederatedTokenStore = (
	vault: Vault
): FederatedTokenStore => ({
	delete: async (userId, provider, revoke) => {
		const current =
			revoke === undefined
				? undefined
				: parse(await vault.get(userId, nameFor(provider)));
		if (current !== undefined && revoke !== undefined) {
			await revoke(current).catch(() => undefined);
		}
		await vault.delete(userId, nameFor(provider));
	},
	get: async (userId, provider) =>
		parse(await vault.get(userId, nameFor(provider))),
	list: async (userId) =>
		(await vault.list(userId))
			.filter((name) => name.startsWith(VAULT_NAME_PREFIX))
			.map((name) => name.slice(VAULT_NAME_PREFIX.length)),
	save: async (userId, provider, tokens) => {
		const record: FederatedTokenSet = { ...tokens, storedAt: Date.now() };
		await vault.put(userId, nameFor(provider), JSON.stringify(record));
	}
});

const isExpired = (tokens: FederatedTokenSet, now: number) => {
	if (tokens.expiresAt === undefined) return false;

	return tokens.expiresAt - REFRESH_EARLY_WINDOW_MS <= now;
};

// What citra's `refreshAccessToken` returns — typed minimally so consumers can pass
// any citra-shaped provider instance (or a stub for tests) without us depending on
// citra's full type surface here.
export type FederatedTokenRefresher = (refreshToken: string) => Promise<{
	access_token: string;
	expires_in?: number;
	refresh_token?: string;
	token_type?: string;
}>;

// Look up the current tokens for a (userId, provider); if expired AND a refresh token
// is on file AND a `refresh` function was passed, swap the access token + save the new
// set. Returns the freshest tokens, or `undefined` if there are no tokens for that
// provider at all. Consumer typically passes their citra provider's
// `refreshAccessToken` bound method.
export const getOrRefreshFederatedTokens = async ({
	now = Date.now(),
	provider,
	refresh,
	store,
	userId
}: {
	now?: number;
	provider: string;
	refresh?: FederatedTokenRefresher;
	store: FederatedTokenStore;
	userId: string;
}): Promise<FederatedTokenSet | undefined> => {
	const current = await store.get(userId, provider);
	if (current === undefined) return undefined;
	if (
		!isExpired(current, now) ||
		current.refreshToken === undefined ||
		refresh === undefined
	) {
		return current;
	}
	const refreshed = await refresh(current.refreshToken);
	const expiresIn =
		typeof refreshed.expires_in === 'number'
			? refreshed.expires_in
			: undefined;
	const updated: Omit<FederatedTokenSet, 'storedAt'> = {
		accessToken: refreshed.access_token,
		expiresAt: expiresIn === undefined ? undefined : now + expiresIn * 1000,
		refreshToken: refreshed.refresh_token ?? current.refreshToken,
		scopes: current.scopes,
		tokenType: refreshed.token_type ?? current.tokenType
	};
	await store.save(userId, provider, updated);

	return { ...updated, storedAt: now };
};
