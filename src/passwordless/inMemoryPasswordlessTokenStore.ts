import type { PasswordlessToken, PasswordlessTokenStore } from './types';

export const createInMemoryPasswordlessTokenStore =
	(): PasswordlessTokenStore => {
		const tokens = new Map<string, PasswordlessToken>();

		return {
			consumeToken: async (tokenHash) => {
				const token = tokens.get(tokenHash);
				if (token) tokens.delete(tokenHash);

				return token ? { ...token } : undefined;
			},
			saveToken: async (token) => {
				tokens.set(token.tokenHash, { ...token });
			}
		};
	};
