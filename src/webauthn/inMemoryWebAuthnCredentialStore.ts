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
			saveCredential: async (credential) => {
				credentials.set(
					credential.credentialId,
					cloneCredential(credential)
				);
			}
		};
	};
