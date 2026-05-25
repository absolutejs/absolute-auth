// A registered WebAuthn credential (passkey), persisted by the consumer's store. All binary
// material is base64url-encoded so the store stays JSON/SQL-friendly and the package never
// imports WebAuthn binary types — those live behind the adapter.
export type WebAuthnCredential = {
	// True for a synced/backed-up passkey (e.g. iCloud Keychain) vs a single-device credential.
	backedUp?: boolean;
	// The authenticator's signature counter; verified to be monotonically increasing on each use.
	counter: number;
	createdAt: number;
	// base64url credential id (the authenticator's handle for this passkey).
	credentialId: string;
	// 'singleDevice' | 'multiDevice', as classified by the adapter from the attestation.
	deviceType?: string;
	lastUsedAt?: number;
	// base64url COSE public key used to verify assertions.
	publicKey: string;
	transports?: string[];
	// The consumer's stable user key (`getUserId`) this passkey belongs to.
	userId: string;
};

// Persistence for passkeys. Lookup-by-id drives passwordless authentication; list-by-user drives
// the registration `excludeCredentials` set and per-user passkey management.
export type WebAuthnCredentialStore = {
	getCredential: (
		credentialId: string
	) => Promise<WebAuthnCredential | undefined>;
	listCredentialsByUser: (userId: string) => Promise<WebAuthnCredential[]>;
	removeCredential: (credentialId: string) => Promise<void>;
	saveCredential: (credential: WebAuthnCredential) => Promise<void>;
};
