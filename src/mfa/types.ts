import type { VerificationPurpose } from '../verification/types';

export type MfaFactorType = 'backup_codes' | 'sms' | 'totp';

export type SmsMfaFactor = {
	id: string;
	label: string;
	phone: string;
	type: 'sms';
	verified: boolean;
};

export type TotpMfaFactor = {
	id: string;
	label: string;
	secretCiphertext: string;
	type: 'totp';
	verified: boolean;
};

export type MfaFactor = SmsMfaFactor | TotpMfaFactor;

export type MfaEnrollment = {
	backupCodeHashes: string[];
	createdAt: number;
	/** Labeled factor collection. Undefined means a legacy single-factor row that
	 * has not yet been rewritten by a management operation. */
	factors?: MfaFactor[];
	lastUsedAt?: number;
	// Count of consecutive failed SMS code verifications since the last fresh code was
	// issued. Reset to 0 whenever a new code is sent and on a successful verification.
	smsFailedAttempts?: number;
	// SHA-256 hash of the pending SMS one-time code. Only the hash is ever persisted —
	// the plaintext is delivered out-of-band via `onSendSmsCode` and never stored.
	smsPendingCodeHash?: string;
	// Epoch-ms expiry of the pending SMS code.
	smsPendingCodeExpiresAt?: number;
	// Purpose and provider reference bind a code to the exact auth operation that issued it.
	smsPendingPurpose?: VerificationPurpose;
	/** Factor selected for the currently active SMS enrollment/challenge. */
	smsPendingFactorId?: string;
	smsProviderReference?: string;
	// Last successful provider/local delivery request. Enforces resend cooldowns.
	smsCodeSentAt?: number;
	/** Opaque generation binding every update to the currently active challenge. */
	smsChallengeId?: string;
	// E.164 phone number the SMS code is delivered to.
	smsPhone?: string;
	smsVerified: boolean;
	// Count of consecutive failed TOTP/backup-code verifications at the login challenge.
	// Tracked separately from any first-factor (password) lockout and reset to 0 on a
	// successful second-factor verification. Independent of `smsFailedAttempts`.
	totpFailedAttempts?: number;
	// TOTP secret encrypted at rest (AES-GCM) when an encryption key is configured,
	// otherwise the raw base32 secret. Never the user's typed code.
	totpSecretCiphertext?: string;
	totpVerified: boolean;
	updatedAt: number;
	userId: string;
};

export type MFAStore = {
	/** Atomically reserves the SMS slot only when the resend cooldown has elapsed. */
	claimSmsChallenge: (input: {
		challengeId: string;
		cooldownCutoff: number;
		enrollment: MfaEnrollment;
	}) => Promise<boolean>;
	completeSmsChallenge: (input: {
		challengeId: string;
		factors?: MfaFactor[];
		lastUsedAt?: number;
		smsVerified: boolean;
		userId: string;
	}) => Promise<boolean>;
	finalizeSmsChallenge: (input: {
		challengeId: string;
		expiresAt: number;
		hash?: string;
		providerReference?: string;
		userId: string;
	}) => Promise<boolean>;
	getEnrollment: (userId: string) => Promise<MfaEnrollment | undefined>;
	// Enumerate every enrollment — used by key rotation (`rotateMfaEncryptionKey`)
	// to sweep all stored TOTP secrets.
	listEnrollments: () => Promise<MfaEnrollment[]>;
	removeEnrollment: (userId: string) => Promise<void>;
	recordSmsFailure: (input: {
		challengeId: string;
		maxAttempts: number;
		userId: string;
	}) => Promise<number | undefined>;
	rollbackSmsChallenge: (input: {
		challengeId: string;
		previous?: MfaEnrollment;
		userId: string;
	}) => Promise<void>;
	saveEnrollment: (enrollment: MfaEnrollment) => Promise<void>;
};

const LEGACY_SMS_FACTOR_ID = 'legacy-sms';
const LEGACY_TOTP_FACTOR_ID = 'legacy-totp';

export const getMfaFactors = (enrollment: MfaEnrollment) => {
	if (enrollment.factors !== undefined) return enrollment.factors;
	const factors: MfaFactor[] = [];
	if (enrollment.totpSecretCiphertext) {
		factors.push({
			id: LEGACY_TOTP_FACTOR_ID,
			label: 'Authenticator app',
			secretCiphertext: enrollment.totpSecretCiphertext,
			type: 'totp',
			verified: enrollment.totpVerified
		});
	}
	if (enrollment.smsPhone) {
		factors.push({
			id: LEGACY_SMS_FACTOR_ID,
			label: 'Text message',
			phone: enrollment.smsPhone,
			type: 'sms',
			verified: enrollment.smsVerified
		});
	}

	return factors;
};

// A user is gated by MFA once a factor is usable: a verified TOTP secret, a verified
// SMS phone, or any remaining backup code.
export const isMfaEnrolled = (enrollment: MfaEnrollment | undefined) =>
	enrollment !== undefined &&
	(getMfaFactors(enrollment).some((factor) => factor.verified) ||
		enrollment.backupCodeHashes.length > 0);

/** Keep the historical single-factor columns synchronized for consumers that
 * have not moved to the factor collection yet. */
export const withMfaFactors = (
	enrollment: MfaEnrollment,
	factors: MfaFactor[]
) => {
	const firstSms = factors.find((factor) => factor.type === 'sms');
	const firstTotp = factors.find((factor) => factor.type === 'totp');

	return {
		...enrollment,
		factors,
		smsPhone: firstSms?.phone,
		smsVerified: firstSms?.verified ?? false,
		totpSecretCiphertext: firstTotp?.secretCiphertext,
		totpVerified: firstTotp?.verified ?? false
	};
};
