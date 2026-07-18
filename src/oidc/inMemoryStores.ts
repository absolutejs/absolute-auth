import type {
	AuthorizationCode,
	AuthorizationCodeStore,
	BackchannelAuthRequest,
	BackchannelAuthStore,
	ClientAssertionJtiStore,
	ClientRegistrationToken,
	ClientRegistrationTokenStore,
	DeviceAuthorization,
	DeviceAuthorizationStore,
	InitialAccessTokenStore,
	LogoutDelivery,
	LogoutDeliveryStore,
	OAuthClient,
	OAuthClientStore,
	OidcRefreshToken,
	OidcRefreshTokenStore,
	PushedAuthorizationRequest,
	PushedAuthorizationRequestStore
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
			deleteForUserClient: async (userId, clientId) => {
				let deleted = 0;
				for (const [hash, code] of codes) {
					if (code.userId !== userId || code.clientId !== clientId)
						continue;
					codes.delete(hash);
					deleted += 1;
				}

				return deleted;
			},
			saveCode: async (code) => {
				codes.set(code.codeHash, { ...code });
			}
		};
	};
export const createInMemoryBackchannelAuthStore = (): BackchannelAuthStore => {
	const byAuthReqId = new Map<string, BackchannelAuthRequest>();

	return {
		deleteByAuthReqId: async (authReqId) => {
			byAuthReqId.delete(authReqId);
		},
		findByAuthReqId: async (authReqId) => byAuthReqId.get(authReqId),
		recordPoll: async (authReqId, polledAt) => {
			const record = byAuthReqId.get(authReqId);
			if (!record) return;
			byAuthReqId.set(authReqId, { ...record, lastPolledAt: polledAt });
		},
		saveBackchannelAuth: async (request) => {
			byAuthReqId.set(request.authReqId, { ...request });
		},
		updateStatus: async (authReqId, status, userSub) => {
			const record = byAuthReqId.get(authReqId);
			if (!record) return;
			byAuthReqId.set(authReqId, { ...record, status, userSub });
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
export const createInMemoryClientRegistrationTokenStore =
	(): ClientRegistrationTokenStore => {
		const byHash = new Map<string, ClientRegistrationToken>();

		return {
			deleteByClientId: async (clientId) => {
				for (const [hash, token] of byHash) {
					if (token.clientId === clientId) byHash.delete(hash);
				}
			},
			findByTokenHash: async (tokenHash) => byHash.get(tokenHash),
			saveToken: async (token) => {
				// One reg token per client — replace any prior token on rotation.
				for (const [hash, existing] of byHash) {
					if (existing.clientId === token.clientId)
						byHash.delete(hash);
				}
				byHash.set(token.tokenHash, { ...token });
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
			deleteForUserClient: async (userId, clientId) => {
				let deleted = 0;
				for (const [hash, authorization] of byDeviceCode) {
					if (
						authorization.userSub !== userId ||
						authorization.clientId !== clientId
					)
						continue;
					byDeviceCode.delete(hash);
					deleted += 1;
				}

				return deleted;
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
				byDeviceCode.set(deviceCodeHash, {
					...record,
					status,
					userSub
				});
			}
		};
	};
export const createInMemoryInitialAccessTokenStore = (
	initialHashes: string[] = []
): InitialAccessTokenStore => {
	const remaining = new Set(initialHashes);

	return {
		consumeToken: async (tokenHash) => {
			if (!remaining.has(tokenHash)) return false;
			remaining.delete(tokenHash);

			return true;
		}
	};
};
export const createInMemoryLogoutDeliveryStore = (): LogoutDeliveryStore => {
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
		deleteClient: async (clientId) => {
			registry.delete(clientId);
		},
		findClient: async (clientId) => registry.get(clientId),
		saveClient: async (client) => {
			registry.set(client.clientId, { ...client });
		},
		updateClient: async (clientId, client) => {
			registry.set(clientId, { ...client });
		}
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
			deleteForUserClient: async (userId, clientId) => {
				let deleted = 0;
				for (const [hash, token] of tokens) {
					if (token.userId !== userId || token.clientId !== clientId)
						continue;
					tokens.delete(hash);
					deleted += 1;
				}

				return deleted;
			},
			getToken: async (tokenHash) => tokens.get(tokenHash),
			listClientIdsForUser: async (userId) => {
				const now = Date.now();
				const active = Array.from(tokens.values()).filter(
					(token) => token.userId === userId && token.expiresAt > now
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
export const createInMemoryPushedAuthorizationRequestStore =
	(): PushedAuthorizationRequestStore => {
		const requests = new Map<string, PushedAuthorizationRequest>();

		return {
			consumeRequest: async (requestUriHash) => {
				const record = requests.get(requestUriHash);
				if (record === undefined) return undefined;
				requests.delete(requestUriHash);
				// Expired entries are GC'd on read so the Map doesn't grow without bound.
				if (record.expiresAt < Date.now()) return undefined;

				return record;
			},
			saveRequest: async (request) => {
				requests.set(request.requestUriHash, { ...request });
			}
		};
	};
