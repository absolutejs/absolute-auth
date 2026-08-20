import { Elysia, t } from 'elysia';
import { constantTimeEqual, hashToken } from '../crypto';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import {
	type VerificationCheckInput,
	type VerificationProvider,
	VerificationProviderError
} from '../verification/types';
import {
	DEFAULT_SMS_CODE_LENGTH,
	DEFAULT_SMS_CODE_TTL_MS,
	DEFAULT_SMS_MAX_ATTEMPTS,
	DEFAULT_SMS_RESEND_COOLDOWN_MS,
	DEFAULT_MFA_MANAGEMENT_AUTH_MAX_AGE_MS,
	type MfaRouteProps,
	type SmsCodeMessage
} from './config';
import type { MfaEnrollment, MFAStore } from './types';
import { hasRecentAuthentication } from './recentAuth';

const DECIMAL_RADIX = 10;
const MASK_VISIBLE_DIGITS = 4;

// E.164: leading '+', a non-zero country-code digit, then 7–14 more digits (8–15 total).
const E164_PATTERN = /^\+[1-9]\d{7,14}$/u;

// Cryptographically-random numeric code. The slight modulo bias over 0-255 is negligible for
// a short-lived one-time code, matching the passwordless OTP generator.
const generateNumericCode = (length: number) => {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);

	return Array.from(bytes, (byte) => (byte % DECIMAL_RADIX).toString()).join(
		''
	);
};

// Generate a fresh SMS code and the values to persist. Only the hash is ever stored; the
// plaintext is returned solely so the caller can hand it to `onSendSmsCode` out-of-band.
const issueSmsCode = async (codeLength: number, ttlMs: number) => {
	const code = generateNumericCode(codeLength);
	const hash = await hashToken(code);
	const expiresAt = Date.now() + ttlMs;

	return { code, expiresAt, hash };
};

const startProviderSmsChallenge = async (input: {
	challengeId: string;
	mfaStore: MFAStore;
	phone: string;
	previousEnrollment?: MfaEnrollment;
	purpose: 'mfa_challenge' | 'mfa_enrollment';
	userId: string;
	verificationProvider: VerificationProvider;
}) => {
	let started;
	try {
		started = await input.verificationProvider.start({
			channel: 'sms',
			purpose: input.purpose,
			subject: input.userId,
			to: input.phone
		});
	} catch (error) {
		await input.mfaStore.rollbackSmsChallenge({
			challengeId: input.challengeId,
			previous: input.previousEnrollment,
			userId: input.userId
		});
		throw error;
	}
	const finalized = await input.mfaStore.finalizeSmsChallenge({
		challengeId: input.challengeId,
		expiresAt: started.expiresAt,
		providerReference: started.reference,
		userId: input.userId
	});
	if (finalized) return started;

	await input.verificationProvider
		.cancel({
			channel: 'sms',
			purpose: input.purpose,
			reference: started.reference,
			subject: input.userId,
			to: input.phone
		})
		.catch(() => undefined);
	throw new SmsChallengeConflictError('SMS challenge claim was lost');
};

export class SmsChallengeConflictError extends Error {
	override name = 'SmsChallengeConflictError';
}
export const checkWithVerificationProvider = async (
	provider: VerificationProvider,
	input: VerificationCheckInput
) => {
	try {
		return { result: await provider.check(input) };
	} catch (error) {
		const mapped = mapVerificationProviderError(error);
		if (mapped === undefined) throw error;

		return { error: mapped };
	}
};
export const isE164Phone = (phone: string) => E164_PATTERN.test(phone);
export const issueAndStoreSmsCode = async ({
	codeLength,
	enrollment,
	mfaStore,
	onSendSmsCode,
	previousEnrollment,
	purpose,
	resendCooldownMs,
	verificationProvider,
	ttlMs,
	userId
}: {
	codeLength: number;
	enrollment: MfaEnrollment;
	mfaStore: MFAStore;
	onSendSmsCode?: (message: SmsCodeMessage) => void | Promise<void>;
	previousEnrollment?: MfaEnrollment;
	verificationProvider?: MfaRouteProps<unknown>['verificationProvider'];
	userId: string;
	purpose: 'mfa_challenge' | 'mfa_enrollment';
	resendCooldownMs: number;
	ttlMs: number;
}) => {
	const phone = enrollment.smsPhone;
	if (phone === undefined) return undefined;
	const challengeId = crypto.randomUUID();
	const now = Date.now();
	const claimed = await mfaStore.claimSmsChallenge({
		challengeId,
		cooldownCutoff: now - resendCooldownMs,
		enrollment: {
			...enrollment,
			smsChallengeId: challengeId,
			smsCodeSentAt: now,
			smsFailedAttempts: 0,
			smsPendingCodeExpiresAt: now + ttlMs,
			smsPendingCodeHash: undefined,
			smsPendingPurpose: purpose,
			smsProviderReference: undefined,
			updatedAt: now
		}
	});
	if (!claimed)
		throw new SmsChallengeConflictError('SMS resend cooldown active');

	if (verificationProvider !== undefined) {
		const started = await startProviderSmsChallenge({
			challengeId,
			mfaStore,
			phone,
			previousEnrollment,
			purpose,
			userId,
			verificationProvider
		});

		return started.expiresAt;
	}

	const { code, expiresAt, hash } = await issueSmsCode(codeLength, ttlMs);
	const finalized = await mfaStore.finalizeSmsChallenge({
		challengeId,
		expiresAt,
		hash,
		userId
	});
	if (!finalized)
		throw new SmsChallengeConflictError('SMS challenge claim was lost');
	try {
		await onSendSmsCode?.({ code, expiresAt, phone, purpose, userId });
	} catch (error) {
		await mfaStore.rollbackSmsChallenge({
			challengeId,
			previous: previousEnrollment,
			userId
		});
		throw error;
	}

	return expiresAt;
};
export const mapVerificationProviderError = (error: unknown) => {
	if (error instanceof SmsChallengeConflictError) {
		return { message: error.message, status: 'Too Many Requests' as const };
	}
	if (!(error instanceof VerificationProviderError)) return undefined;
	if (error.kind === 'rate_limited') {
		return {
			message: 'Verification provider rate limit reached',
			status: 'Too Many Requests' as const
		};
	}
	if (error.kind === 'invalid_destination') {
		return {
			message: 'Phone number cannot receive verification codes',
			status: 'Bad Request' as const
		};
	}

	return {
		message: 'Verification provider unavailable',
		status: 'Service Unavailable' as const
	};
};
export const maskPhone = (phone: string) => {
	const visible = phone.slice(-MASK_VISIBLE_DIGITS);
	const maskedLength = Math.max(phone.length - MASK_VISIBLE_DIGITS, 0);

	return `${'•'.repeat(maskedLength)}${visible}`;
};
export const mfaSmsRoutes = <UserType>({
	authSessionStore,
	getUserId,
	mfaStore,
	managementAuthMaxAgeMs = DEFAULT_MFA_MANAGEMENT_AUTH_MAX_AGE_MS,
	onMfaEnrolled,
	onSendSmsCode,
	verificationProvider,
	smsCodeLength = DEFAULT_SMS_CODE_LENGTH,
	smsCodeTtlMs = DEFAULT_SMS_CODE_TTL_MS,
	smsMaxAttempts = DEFAULT_SMS_MAX_ATTEMPTS,
	smsResendCooldownMs = DEFAULT_SMS_RESEND_COOLDOWN_MS,
	smsSetupRoute = '/auth/mfa/sms/setup',
	smsVerifyRoute = '/auth/mfa/sms/verify'
}: MfaRouteProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.post(
			smsSetupRoute,
			{
				body: t.Object({ phone: t.String() }),
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
			},
			async ({
				body: { phone },
				cookie: { user_session_id },
				status,
				store: { session }
			}) => {
				if (
					onSendSmsCode === undefined &&
					verificationProvider === undefined
				) {
					return status(
						'Not Implemented',
						'SMS MFA is not configured'
					);
				}

				const userSession = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});
				if (!userSession) {
					return status('Unauthorized', 'Authentication required');
				}
				if (
					!hasRecentAuthentication(
						userSession,
						managementAuthMaxAgeMs
					)
				) {
					return status(
						'Unauthorized',
						'Recent authentication required'
					);
				}

				if (!isE164Phone(phone)) {
					return status(
						'Bad Request',
						'Phone must be in E.164 format'
					);
				}

				const userId = getUserId(userSession.user);
				const existing = await mfaStore.getEnrollment(userId);
				const now = Date.now();
				if (
					existing?.smsCodeSentAt !== undefined &&
					now - existing.smsCodeSentAt < smsResendCooldownMs
				) {
					return status(
						'Too Many Requests',
						'SMS resend cooldown active'
					);
				}
				try {
					await issueAndStoreSmsCode({
						codeLength: smsCodeLength,
						enrollment: {
							backupCodeHashes: existing?.backupCodeHashes ?? [],
							createdAt: existing?.createdAt ?? now,
							lastUsedAt: existing?.lastUsedAt,
							smsFailedAttempts: 0,
							smsPhone: phone,
							smsVerified: false,
							totpFailedAttempts:
								existing?.totpFailedAttempts ?? 0,
							totpSecretCiphertext:
								existing?.totpSecretCiphertext,
							totpVerified: existing?.totpVerified ?? false,
							updatedAt: now,
							userId
						},
						mfaStore,
						onSendSmsCode,
						previousEnrollment: existing,
						purpose: 'mfa_enrollment',
						resendCooldownMs: smsResendCooldownMs,
						ttlMs: smsCodeTtlMs,
						userId,
						verificationProvider
					});
				} catch (error) {
					const mapped = mapVerificationProviderError(error);
					if (mapped === undefined) throw error;

					return status(mapped.status, mapped.message);
				}

				return status('OK', { phone: maskPhone(phone) });
			}
		)
		.post(
			smsVerifyRoute,
			{
				body: t.Object({ code: t.String() }),
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
			},
			async ({
				body: { code },
				cookie: { user_session_id },
				status,
				store: { session }
			}) => {
				const userSession = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});
				if (!userSession) {
					return status('Unauthorized', 'Authentication required');
				}
				if (
					!hasRecentAuthentication(
						userSession,
						managementAuthMaxAgeMs
					)
				) {
					return status(
						'Unauthorized',
						'Recent authentication required'
					);
				}

				const userId = getUserId(userSession.user);
				const enrollment = await mfaStore.getEnrollment(userId);
				if (!enrollment?.smsPhone) {
					return status(
						'Bad Request',
						'No SMS enrollment in progress'
					);
				}

				const localCodeHash = enrollment.smsPendingCodeHash;
				const challengeId = enrollment.smsChallengeId;
				const localCodeExpiresAt = enrollment.smsPendingCodeExpiresAt;
				const providerReference = enrollment.smsProviderReference;
				if (
					enrollment.smsPendingPurpose !== 'mfa_enrollment' ||
					localCodeExpiresAt === undefined ||
					challengeId === undefined
				) {
					return status(
						'Bad Request',
						'No SMS enrollment in progress'
					);
				}
				if (
					verificationProvider === undefined &&
					localCodeHash === undefined
				) {
					return status(
						'Bad Request',
						'No SMS enrollment in progress'
					);
				}

				if (Date.now() > localCodeExpiresAt) {
					return status('Bad Request', 'SMS code expired');
				}

				if ((enrollment.smsFailedAttempts ?? 0) >= smsMaxAttempts) {
					return status('Too Many Requests', 'Too many attempts');
				}

				let providerResult;
				if (verificationProvider !== undefined) {
					if (providerReference === undefined) {
						return status(
							'Bad Request',
							'No SMS enrollment in progress'
						);
					}
					const checked = await checkWithVerificationProvider(
						verificationProvider,
						{
							channel: 'sms',
							code,
							purpose: 'mfa_enrollment',
							reference: providerReference,
							subject: userId,
							to: enrollment.smsPhone
						}
					);
					if (checked.error !== undefined) {
						return status(
							checked.error.status,
							checked.error.message
						);
					}
					providerResult = checked.result;
				}
				const codeValid = providerResult
					? providerResult.status === 'approved'
					: localCodeHash !== undefined &&
						(await constantTimeEqual(
							await hashToken(code),
							localCodeHash
						));
				if (!codeValid) {
					const attempts = await mfaStore.recordSmsFailure({
						challengeId,
						maxAttempts: smsMaxAttempts,
						userId
					});

					return status(
						providerResult?.status === 'max_attempts_reached' ||
							attempts === undefined
							? 'Too Many Requests'
							: 'Bad Request',
						providerResult?.status === 'expired'
							? 'SMS code expired'
							: 'Invalid SMS code'
					);
				}

				const completed = await mfaStore.completeSmsChallenge({
					challengeId,
					smsVerified: true,
					userId
				});
				if (!completed) {
					return status(
						'Bad Request',
						'SMS challenge is no longer active'
					);
				}
				await onMfaEnrolled?.({ userId });

				return status('OK', { status: 'enrolled' });
			}
		);
