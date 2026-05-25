export type MfaFactorType = 'backup_codes' | 'totp';

export type MfaEnrollment = {
	backupCodeHashes: string[];
	createdAt: number;
	lastUsedAt?: number;
	// TOTP secret encrypted at rest (AES-GCM) when an encryption key is configured,
	// otherwise the raw base32 secret. Never the user's typed code.
	totpSecretCiphertext?: string;
	totpVerified: boolean;
	updatedAt: number;
	userId: string;
};

export type MFAStore = {
	getEnrollment: (userId: string) => Promise<MfaEnrollment | undefined>;
	// Enumerate every enrollment — used by key rotation (`rotateMfaEncryptionKey`)
	// to sweep all stored TOTP secrets.
	listEnrollments: () => Promise<MfaEnrollment[]>;
	removeEnrollment: (userId: string) => Promise<void>;
	saveEnrollment: (enrollment: MfaEnrollment) => Promise<void>;
};

// A user is gated by MFA once a factor is usable: a verified TOTP secret or any
// remaining backup code.
export const isMfaEnrolled = (enrollment: MfaEnrollment | undefined) =>
	enrollment !== undefined &&
	(enrollment.totpVerified || enrollment.backupCodeHashes.length > 0);
