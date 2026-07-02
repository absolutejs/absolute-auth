import { Elysia, t } from 'elysia';
import { constantTimeEqual, hashToken } from '../crypto';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import {
	DEFAULT_SMS_CODE_LENGTH,
	DEFAULT_SMS_CODE_TTL_MS,
	DEFAULT_SMS_MAX_ATTEMPTS,
	type MfaRouteProps,
	type SmsCodeMessage
} from './config';
import type { MfaEnrollment, MFAStore } from './types';

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

export const isE164Phone = (phone: string) => E164_PATTERN.test(phone);

// Issue + persist + deliver a fresh code for an existing enrollment that already has a phone.
// Used by the challenge "send" action (and re-send during a login). Resets the attempt
// counter because a new code invalidates the old one. Returns the expiry, or undefined when
// the enrollment has no phone to deliver to.
export const issueAndStoreSmsCode = async ({
	codeLength,
	enrollment,
	mfaStore,
	onSendSmsCode,
	ttlMs
}: {
	codeLength: number;
	enrollment: MfaEnrollment;
	mfaStore: MFAStore;
	onSendSmsCode?: (message: SmsCodeMessage) => void | Promise<void>;
	ttlMs: number;
}) => {
	const phone = enrollment.smsPhone;
	if (phone === undefined) return undefined;

	const { code, expiresAt, hash } = await issueSmsCode(codeLength, ttlMs);
	await mfaStore.saveEnrollment({
		...enrollment,
		smsFailedAttempts: 0,
		smsPendingCodeExpiresAt: expiresAt,
		smsPendingCodeHash: hash,
		updatedAt: Date.now()
	});
	await onSendSmsCode?.({ code, expiresAt, phone });

	return expiresAt;
};

// Mask all but the trailing digits so a route can echo which number a code was sent to
// without disclosing the full number.
export const maskPhone = (phone: string) => {
	const visible = phone.slice(-MASK_VISIBLE_DIGITS);
	const maskedLength = Math.max(phone.length - MASK_VISIBLE_DIGITS, 0);

	return `${'•'.repeat(maskedLength)}${visible}`;
};

export const mfaSmsRoutes = <UserType>({
	authSessionStore,
	getUserId,
	mfaStore,
	onMfaEnrolled,
	onSendSmsCode,
	smsCodeLength = DEFAULT_SMS_CODE_LENGTH,
	smsCodeTtlMs = DEFAULT_SMS_CODE_TTL_MS,
	smsMaxAttempts = DEFAULT_SMS_MAX_ATTEMPTS,
	smsSetupRoute = '/auth/mfa/sms/setup',
	smsVerifyRoute = '/auth/mfa/sms/verify'
}: MfaRouteProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.post(
			smsSetupRoute,
			async ({
				body: { phone },
				cookie: { user_session_id },
				status,
				store: { session }
			}) => {
				if (onSendSmsCode === undefined) {
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

				if (!isE164Phone(phone)) {
					return status(
						'Bad Request',
						'Phone must be in E.164 format'
					);
				}

				const userId = getUserId(userSession.user);
				const existing = await mfaStore.getEnrollment(userId);
				const now = Date.now();
				const { code, expiresAt, hash } = await issueSmsCode(
					smsCodeLength,
					smsCodeTtlMs
				);
				await mfaStore.saveEnrollment({
					backupCodeHashes: existing?.backupCodeHashes ?? [],
					createdAt: existing?.createdAt ?? now,
					smsFailedAttempts: 0,
					smsPendingCodeExpiresAt: expiresAt,
					smsPendingCodeHash: hash,
					smsPhone: phone,
					smsVerified: false,
					totpSecretCiphertext: existing?.totpSecretCiphertext,
					totpVerified: existing?.totpVerified ?? false,
					updatedAt: now,
					userId
				});
				await onSendSmsCode({ code, expiresAt, phone });

				return status('OK', { phone: maskPhone(phone) });
			},
			{
				body: t.Object({ phone: t.String() }),
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
			}
		)
		.post(
			smsVerifyRoute,
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

				const userId = getUserId(userSession.user);
				const enrollment = await mfaStore.getEnrollment(userId);
				if (
					!enrollment?.smsPendingCodeHash ||
					enrollment.smsPendingCodeExpiresAt === undefined
				) {
					return status(
						'Bad Request',
						'No SMS enrollment in progress'
					);
				}

				if (Date.now() > enrollment.smsPendingCodeExpiresAt) {
					return status('Bad Request', 'SMS code expired');
				}

				if ((enrollment.smsFailedAttempts ?? 0) >= smsMaxAttempts) {
					return status('Too Many Requests', 'Too many attempts');
				}

				const codeValid = await constantTimeEqual(
					await hashToken(code),
					enrollment.smsPendingCodeHash
				);
				if (!codeValid) {
					await mfaStore.saveEnrollment({
						...enrollment,
						smsFailedAttempts:
							(enrollment.smsFailedAttempts ?? 0) + 1,
						updatedAt: Date.now()
					});

					return status('Bad Request', 'Invalid SMS code');
				}

				await mfaStore.saveEnrollment({
					...enrollment,
					smsFailedAttempts: 0,
					smsPendingCodeExpiresAt: undefined,
					smsPendingCodeHash: undefined,
					smsVerified: true,
					updatedAt: Date.now()
				});
				await onMfaEnrolled?.({ userId });

				return status('OK', { status: 'enrolled' });
			},
			{
				body: t.Object({ code: t.String() }),
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
			}
		);
