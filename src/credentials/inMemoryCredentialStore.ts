import type { CredentialRecord, CredentialStore, CredentialToken } from './types';

const cloneCredential = (value: CredentialRecord): CredentialRecord => ({
	...value
});

const cloneToken = (value: CredentialToken): CredentialToken => ({ ...value });

const consumeToken = (
	tokens: Map<string, CredentialToken>,
	tokenHash: string
) => {
	const token = tokens.get(tokenHash);
	if (!token) return undefined;

	tokens.delete(tokenHash);
	if (token.expiresAt < Date.now()) return undefined;

	return cloneToken(token);
};

export const createInMemoryCredentialStore = (): CredentialStore => {
	const credentials = new Map<string, CredentialRecord>();
	const verificationTokens = new Map<string, CredentialToken>();
	const resetTokens = new Map<string, CredentialToken>();

	return {
		consumeResetToken: async (tokenHash) =>
			consumeToken(resetTokens, tokenHash),
		consumeVerificationToken: async (tokenHash) =>
			consumeToken(verificationTokens, tokenHash),
		getCredentialByEmail: async (email) => {
			const credential = credentials.get(email.toLowerCase());

			return credential ? cloneCredential(credential) : undefined;
		},
		saveCredential: async (credential) => {
			credentials.set(
				credential.email.toLowerCase(),
				cloneCredential(credential)
			);
		},
		saveResetToken: async (token) => {
			resetTokens.set(token.tokenHash, cloneToken(token));
		},
		saveVerificationToken: async (token) => {
			verificationTokens.set(token.tokenHash, cloneToken(token));
		},
		setEmailVerified: async (email) => {
			const credential = credentials.get(email.toLowerCase());
			if (!credential) return;

			credentials.set(email.toLowerCase(), {
				...credential,
				emailVerified: true,
				updatedAt: Date.now()
			});
		}
	};
};
