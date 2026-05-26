import type {
	AuthorizationCode,
	AuthorizationCodeStore,
	DeviceAuthorization,
	DeviceAuthorizationStore,
	OAuthClient,
	OAuthClientStore,
	OidcRefreshToken,
	OidcRefreshTokenStore
} from './types';

export const createInMemoryAuthorizationCodeStore =
	(): AuthorizationCodeStore => {
		const codes = new Map<string, AuthorizationCode>();

		return {
			consumeCode: async (codeHash) => {
				const record = codes.get(codeHash);
				codes.delete(codeHash);

				return record;
			},
			saveCode: async (code) => {
				codes.set(code.codeHash, { ...code });
			}
		};
	};
export const createInMemoryDeviceAuthorizationStore =
	(): DeviceAuthorizationStore => {
		const byDeviceCode = new Map<string, DeviceAuthorization>();

		return {
			deleteByDeviceCodeHash: async (deviceCodeHash) => {
				byDeviceCode.delete(deviceCodeHash);
			},
			findByDeviceCodeHash: async (deviceCodeHash) =>
				byDeviceCode.get(deviceCodeHash),
			findByUserCode: async (userCode) => {
				for (const record of byDeviceCode.values()) {
					if (record.userCode === userCode) return record;
				}

				return undefined;
			},
			saveDeviceAuthorization: async (deviceAuthorization) => {
				byDeviceCode.set(deviceAuthorization.deviceCodeHash, {
					...deviceAuthorization
				});
			},
			updateStatus: async (deviceCodeHash, status, userSub) => {
				const record = byDeviceCode.get(deviceCodeHash);
				if (!record) return;
				byDeviceCode.set(deviceCodeHash, { ...record, status, userSub });
			}
		};
	};
export const createInMemoryOAuthClientStore = (
	clients: OAuthClient[]
): OAuthClientStore => {
	const registry = new Map(
		clients.map((client) => [client.clientId, client])
	);

	return {
		findClient: async (clientId) => registry.get(clientId)
	};
};
export const createInMemoryOidcRefreshTokenStore =
	(): OidcRefreshTokenStore => {
		const tokens = new Map<string, OidcRefreshToken>();

		return {
			consumeToken: async (tokenHash) => {
				const record = tokens.get(tokenHash);
				tokens.delete(tokenHash);

				return record;
			},
			deleteForUser: async (userId) => {
				for (const [hash, token] of tokens) {
					if (token.userId === userId) tokens.delete(hash);
				}
			},
			getToken: async (tokenHash) => tokens.get(tokenHash),
			saveToken: async (token) => {
				tokens.set(token.tokenHash, { ...token });
			}
		};
	};
