export type MfaFactorType = 'backup_codes' | 'sms' | 'totp';

export type MfaEnrollment = {
	backupCodeHashes: string[];
	createdAt: number;
	lastUsedAt?: number;
	// Count of consecutive failed SMS code verifications since the last fresh code was
	// issued. Reset to 0 whenever a new code is sent and on a successful verification.
	smsFailedAttempts?: number;
	// SHA-256 hash of the pending SMS one-time code. Only the hash is ever persisted —
	// the plaintext is delivered out-of-band via `onSendSmsCode` and never stored.
	smsPendingCodeHash?: string;
	// Epoch-ms expiry of the pending SMS code.
	smsPendingCodeExpiresAt?: number;
	// E.164 phone number the SMS code is delivered to.
	smsPhone?: string;
	smsVerified: boolean;
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

// A user is gated by MFA once a factor is usable: a verified TOTP secret, a verified
// SMS phone, or any remaining backup code.
export const isMfaEnrolled = (enrollment: MfaEnrollment | undefined) =>
	enrollment !== undefined &&
	(enrollment.totpVerified ||
		enrollment.smsVerified ||
		enrollment.backupCodeHashes.length > 0);
