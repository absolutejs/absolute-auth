import type { ScimToken, ScimTokenStore } from './types';

export const createInMemoryScimTokenStore = (): ScimTokenStore => {
	const tokens = new Map<string, ScimToken>();

	return {
		deleteToken: async (tokenId) => {
			tokens.delete(tokenId);
		},
		findByHashedToken: async (hashedToken) =>
			Array.from(tokens.values()).find(
				(token) => token.hashedToken === hashedToken
			),
		listTokens: async (organizationId) =>
			Array.from(tokens.values())
				.filter((token) => token.organizationId === organizationId)
				.sort((left, right) => right.createdAt - left.createdAt),
		saveToken: async (token) => {
			tokens.set(token.tokenId, { ...token });
		}
	};
};
