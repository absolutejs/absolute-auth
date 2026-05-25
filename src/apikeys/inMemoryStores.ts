import type {
	AccessToken,
	AccessTokenStore,
	ApiClient,
	ApiClientStore,
	ApiKey,
	ApiKeyStore
} from './types';

export const createInMemoryAccessTokenStore = (): AccessTokenStore => {
	const tokens = new Map<string, AccessToken>();

	return {
		deleteExpired: async (now) => {
			for (const [tokenId, token] of tokens) {
				if (token.expiresAt <= now) tokens.delete(tokenId);
			}
		},
		deleteToken: async (tokenId) => {
			tokens.delete(tokenId);
		},
		findByHashedToken: async (hashedToken) =>
			Array.from(tokens.values()).find(
				(token) => token.hashedToken === hashedToken
			),
		saveToken: async (token) => {
			tokens.set(token.tokenId, { ...token });
		}
	};
};
export const createInMemoryApiClientStore = (): ApiClientStore => {
	const clients = new Map<string, ApiClient>();

	return {
		deleteClient: async (clientId) => {
			clients.delete(clientId);
		},
		findClient: async (clientId) => clients.get(clientId),
		listClients: async (ownerId) =>
			Array.from(clients.values())
				.filter(
					(client) =>
						ownerId === undefined || client.ownerId === ownerId
				)
				.sort((left, right) => right.createdAt - left.createdAt),
		saveClient: async (client) => {
			clients.set(client.clientId, { ...client });
		}
	};
};
export const createInMemoryApiKeyStore = (): ApiKeyStore => {
	const keys = new Map<string, ApiKey>();

	return {
		deleteKey: async (keyId) => {
			keys.delete(keyId);
		},
		findByHashedKey: async (hashedKey) =>
			Array.from(keys.values()).find((key) => key.hashedKey === hashedKey),
		listKeys: async (ownerId) =>
			Array.from(keys.values())
				.filter((key) => ownerId === undefined || key.ownerId === ownerId)
				.sort((left, right) => right.createdAt - left.createdAt),
		saveKey: async (key) => {
			keys.set(key.keyId, { ...key });
		},
		touchKey: async (keyId, lastUsedAt) => {
			const existing = keys.get(keyId);
			if (existing !== undefined) {
				keys.set(keyId, { ...existing, lastUsedAt });
			}
		}
	};
};
