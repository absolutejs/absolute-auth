import type { OrganizationId } from '../tenancy';

export type CredentialStatus = 'active' | 'disabled';

export type CredentialRecord = {
	createdAt: number;
	email: string;
	emailVerified: boolean;
	organizationId?: OrganizationId;
	passwordHash: string;
	status: CredentialStatus;
	updatedAt: number;
	userId?: string;
};

export type CredentialToken = {
	email: string;
	expiresAt: number;
	tokenHash: string;
};

// The consumer owns the user table; this store holds only the auth material that is
// never the consumer's concern: password hashes and single-use, hashed-at-rest
// verification / reset tokens. No plaintext password or raw token is ever stored.
export type CredentialStore = {
	consumeResetToken: (
		tokenHash: string
	) => Promise<CredentialToken | undefined>;
	consumeVerificationToken: (
		tokenHash: string
	) => Promise<CredentialToken | undefined>;
	getCredentialByEmail: (
		email: string
	) => Promise<CredentialRecord | undefined>;
	saveCredential: (credential: CredentialRecord) => Promise<void>;
	saveResetToken: (token: CredentialToken) => Promise<void>;
	saveVerificationToken: (token: CredentialToken) => Promise<void>;
	setEmailVerified: (email: string) => Promise<void>;
};
