import type {
	AuthorizationCode,
	AuthorizationCodeStore,
	ClientAssertionJtiStore,
	DeviceAuthorization,
	DeviceAuthorizationStore,
	LogoutDelivery,
	LogoutDeliveryStore,
	OAuthClient,
	OAuthClientStore,
	OidcRefreshToken,
	OidcRefreshTokenStore
} from './types';

const DEFAULT_LIST_LIMIT = 100;

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
export const createInMemoryClientAssertionJtiStore =
	(): ClientAssertionJtiStore => {
		const seen = new Map<string, number>();

		return {
			recordIfFresh: async (clientId, jti, expiresAt) => {
				const now = Date.now();
				// Lazy GC: skim expired keys so the Map doesn't grow without bound.
				for (const [key, expiry] of seen) {
					if (expiry < now) seen.delete(key);
				}
				const composite = `${clientId}|${jti}`;
				if (seen.has(composite)) return false;
				seen.set(composite, expiresAt);

				return true;
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
export const createInMemoryLogoutDeliveryStore =
	(): LogoutDeliveryStore => {
		const failures = new Map<string, LogoutDelivery>();

		return {
			listFailed: async (limit = DEFAULT_LIST_LIMIT) =>
				Array.from(failures.values())
					.sort((left, right) => right.createdAt - left.createdAt)
					.slice(0, limit),
			recordFailure: async (delivery) => {
				failures.set(delivery.id, delivery);
			},
			removeFailure: async (deliveryId) => {
				failures.delete(deliveryId);
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
			listClientIdsForUser: async (userId) => {
				const now = Date.now();
				const active = Array.from(tokens.values()).filter(
					(token) =>
						token.userId === userId && token.expiresAt > now
				);

				return Array.from(
					new Set(active.map((token) => token.clientId))
				);
			},
			saveToken: async (token) => {
				tokens.set(token.tokenHash, { ...token });
			}
		};
	};
