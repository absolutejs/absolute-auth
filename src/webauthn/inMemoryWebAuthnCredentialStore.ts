import type { WebAuthnCredential, WebAuthnCredentialStore } from './types';

const cloneCredential = (value: WebAuthnCredential): WebAuthnCredential => ({
	...value,
	transports: value.transports ? [...value.transports] : undefined
});

export const createInMemoryWebAuthnCredentialStore =
	(): WebAuthnCredentialStore => {
		const credentials = new Map<string, WebAuthnCredential>();

		return {
			getCredential: async (credentialId) => {
				const credential = credentials.get(credentialId);

				return credential ? cloneCredential(credential) : undefined;
			},
			listCredentialsByUser: async (userId) =>
				[...credentials.values()]
					.filter((credential) => credential.userId === userId)
					.map(cloneCredential),
			removeCredential: async (credentialId) => {
				credentials.delete(credentialId);
			},
			renameCredential: async (credentialId, name) => {
				const credential = credentials.get(credentialId);
				if (credential) credential.name = name;
			},
			saveCredential: async (credential) => {
				const previous = credentials.get(credential.credentialId);
				if (
					previous &&
					(previous.userId !== credential.userId ||
						previous.publicKey !== credential.publicKey ||
						credential.counter < previous.counter)
				)
					throw new Error('Credential ownership or counter conflict');
				credentials.set(
					credential.credentialId,
					cloneCredential(credential)
				);
			}
		};
	};
