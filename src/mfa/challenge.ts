import { Elysia, t } from 'elysia';
import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { constantTimeEqual, hashToken, verifyTotp } from '../crypto';
import { createSessionCompatibilityLayer } from '../session/access';
import { persistWhen } from '../session/promote';
import { sessionStore } from '../session/state';
import { withSpan } from '../telemetry/tracing';
import { userSessionIdTypebox } from '../typebox';
import { resolveCookieSecure } from '../utils';
import {
	DEFAULT_MFA_SESSION_TTL_MS,
	DEFAULT_MFA_CODE_ATTEMPT_WINDOW_MS,
	DEFAULT_SMS_CODE_LENGTH,
	DEFAULT_SMS_CODE_TTL_MS,
	DEFAULT_SMS_MAX_ATTEMPTS,
	DEFAULT_SMS_SEND_MAX_ATTEMPTS,
	DEFAULT_SMS_RESEND_COOLDOWN_MS,
	DEFAULT_TOTP_MAX_ATTEMPTS,
	type MfaRouteProps
} from './config';
import { decryptTotpSecret } from './secret';
import {
	checkWithVerificationProvider,
	issueAndStoreSmsCode,
	mapVerificationProviderError,
	maskPhone
} from './sms';
import { getMfaFactors, type TotpMfaFactor } from './types';

export type MfaChallengeOptions = {
	backupCodesAvailable: boolean;
	factors: Array<{
		id: string;
		label: string;
		phone: string | null;
		type: 'sms' | 'totp';
	}>;
};

export const mfaChallenge = <UserType>({
	authSessionStore,
	challengeRoute = '/auth/mfa/challenge',
	cookieSecure,
	encryptionKey,
	getChallengeUser,
	getUserId,
	mfaStore,
	onMfaChallengeError,
	onMfaChallengeSuccess,
	onSendSmsCode,
	verificationProvider,
	sessionDurationMs = DEFAULT_MFA_SESSION_TTL_MS,
	smsCodeLength = DEFAULT_SMS_CODE_LENGTH,
	smsCodeTtlMs = DEFAULT_SMS_CODE_TTL_MS,
	smsMaxAttempts = DEFAULT_SMS_MAX_ATTEMPTS,
	smsSendMaxAttempts = DEFAULT_SMS_SEND_MAX_ATTEMPTS,
	smsSendWindowMs = DEFAULT_MFA_CODE_ATTEMPT_WINDOW_MS,
	smsResendCooldownMs = DEFAULT_SMS_RESEND_COOLDOWN_MS,
	totpMaxAttempts = DEFAULT_TOTP_MAX_ATTEMPTS,
	backupCodeMaxAttempts = DEFAULT_TOTP_MAX_ATTEMPTS,
	codeAttemptWindowMs = DEFAULT_MFA_CODE_ATTEMPT_WINDOW_MS
}: MfaRouteProps<UserType>) => {
	for (const value of [
		totpMaxAttempts,
		backupCodeMaxAttempts,
		codeAttemptWindowMs,
		smsSendMaxAttempts,
		smsSendWindowMs
	]) {
		if (!Number.isSafeInteger(value) || value <= 0)
			throw new Error(
				'MFA attempt limits and window must be positive safe integers'
			);
	}

	return new Elysia()
		.use(sessionStore<UserType>())
		.get(
			challengeRoute,
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) },
			async ({
				cookie: { user_session_id },
				status,
				store: { unregisteredSession }
			}) => {
				const compatibilityLayer =
					await createSessionCompatibilityLayer({
						authSessionStore,
						userSessionId: user_session_id.value
					});
				const challengeUnregistered = authSessionStore
					? compatibilityLayer.unregisteredSession
					: unregisteredSession;
				const pendingId = user_session_id.value;
				const pending = pendingId
					? challengeUnregistered[pendingId]
					: undefined;
				if (!pending || pending.expiresAt <= Date.now()) {
					return status(
						'Unauthorized',
						'No MFA challenge in progress'
					);
				}
				const user = await getChallengeUser(pending.userIdentity ?? {});
				const enrollment = user
					? await mfaStore.getEnrollment(getUserId(user))
					: undefined;
				if (!enrollment) {
					return status(
						'Unauthorized',
						'No MFA challenge in progress'
					);
				}
				const response: MfaChallengeOptions = {
					backupCodesAvailable:
						enrollment.backupCodeHashes.length > 0,
					factors: getMfaFactors(enrollment)
						.filter((factor) => factor.verified)
						.map((factor) => ({
							id: factor.id,
							label: factor.label,
							phone:
								factor.type === 'sms'
									? maskPhone(factor.phone)
									: null,
							type: factor.type
						}))
				};

				return status('OK', response);
			}
		)
		.post(
			challengeRoute,
			{
				body: t.Object({
					action: t.Optional(
						t.Union([t.Literal('send'), t.Literal('verify')])
					),
					code: t.Optional(t.String()),
					factor: t.Optional(
						t.Union([
							t.Literal('backup_codes'),
							t.Literal('sms'),
							t.Literal('totp')
						])
					),
					factorId: t.Optional(t.String())
				}),
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
			},
			async ({
				body: { action, code, factor, factorId },
				set,
				cookie: { user_session_id },
				status,
				store: { session, unregisteredSession }
			}) =>
				withSpan('auth.mfa.challenge', undefined, async () => {
					const compatibilityLayer =
						await createSessionCompatibilityLayer({
							authSessionStore,
							userSessionId: user_session_id.value
						});
					const challengeSession = authSessionStore
						? compatibilityLayer.session
						: session;
					const challengeUnregistered = authSessionStore
						? compatibilityLayer.unregisteredSession
						: unregisteredSession;
					const pendingId = user_session_id.value;
					const pending = pendingId
						? challengeUnregistered[pendingId]
						: undefined;
					if (
						!pendingId ||
						!pending ||
						pending.expiresAt <= Date.now()
					) {
						return status(
							'Unauthorized',
							'No MFA challenge in progress'
						);
					}

					const user = await getChallengeUser(
						pending.userIdentity ?? {}
					);
					const enrollment = user
						? await mfaStore.getEnrollment(getUserId(user))
						: undefined;
					if (!user || !enrollment) {
						return status(
							'Unauthorized',
							'No MFA challenge in progress'
						);
					}
					const factors = getMfaFactors(enrollment);

					// Promote the parked challenge into an authenticated session. Shared by every
					// factor's success path.
					const promote = async () => {
						delete challengeUnregistered[pendingId];
						const userSessionId = crypto.randomUUID();
						challengeSession[userSessionId] = {
							authenticatedAt: Date.now(),
							expiresAt: Date.now() + sessionDurationMs,
							user
						};
						user_session_id.set({
							httpOnly: true,
							sameSite: 'lax',
							secure: resolveCookieSecure(cookieSecure),
							value: userSessionId
						});
						await persistWhen(
							authSessionStore !== undefined,
							compatibilityLayer.persist
						);
						await onMfaChallengeSuccess?.({ user, userSessionId });

						return status('OK', { status: 'authenticated' });
					};

					const runSmsChallenge = async () => {
						const smsFactor = factors.find(
							(candidate) =>
								candidate.type === 'sms' &&
								candidate.verified &&
								(candidate.id === factorId ||
									factorId === undefined)
						);
						if (!smsFactor || smsFactor.type !== 'sms')
							return status(
								'Bad Request',
								'SMS factor not found'
							);
						const userId = getUserId(user);
						const smsStore = await mfaStore.getSmsChallengeStore({
							expiresAt: pending.expiresAt,
							factorId: smsFactor.id,
							sessionId: pendingId,
							userId
						});
						const smsEnrollment =
							await smsStore.getEnrollment(userId);
						const cooldown = async () => {
							const current =
								await smsStore.getEnrollment(userId);
							const retryAfterMs = Math.max(
								1,
								(current?.smsCodeSentAt ?? Date.now()) +
									smsResendCooldownMs -
									Date.now()
							);
							set.headers['Retry-After'] = String(
								Math.ceil(
									retryAfterMs / MILLISECONDS_IN_A_SECOND
								)
							);

							return status('Too Many Requests', {
								code: 'sms_resend_cooldown',
								message:
									'Wait before requesting another text to this phone.',
								retryAfterMs
							});
						};
						const sendSmsChallenge = async () => {
							if (
								smsEnrollment?.smsCodeSentAt !== undefined &&
								Date.now() - smsEnrollment.smsCodeSentAt <
									smsResendCooldownMs
							)
								return cooldown();
							// Retain an account delivery ceiling while allowing independent phones/logins.
							const delivery = await mfaStore.claimCodeAttempt({
								factor: 'sms_send',
								maxAttempts: smsSendMaxAttempts,
								now: Date.now(),
								userId,
								windowMs: smsSendWindowMs
							});
							if (!delivery.allowed) {
								set.headers['Retry-After'] = String(
									Math.ceil(
										delivery.retryAfterMs /
											MILLISECONDS_IN_A_SECOND
									)
								);

								return status('Too Many Requests', {
									code: 'sms_delivery_rate_limited',
									message:
										'Too many text requests. Try again later or choose another sign-in method.',
									retryAfterMs: delivery.retryAfterMs
								});
							}
							try {
								const now = Date.now();
								const expiresAt = await issueAndStoreSmsCode({
									codeLength: smsCodeLength,
									enrollment: {
										backupCodeHashes: [],
										createdAt: now,
										smsPendingFactorId: smsFactor.id,
										smsPhone: smsFactor.phone,
										smsVerified: true,
										totpVerified: false,
										updatedAt: now,
										userId
									},
									mfaStore: smsStore,
									onSendSmsCode,
									previousEnrollment: smsEnrollment,
									purpose: 'mfa_challenge',
									resendCooldownMs: smsResendCooldownMs,
									ttlMs: smsCodeTtlMs,
									userId,
									verificationProvider
								});

								return status('OK', {
									expiresAt,
									factorId: smsFactor.id,
									phone: maskPhone(smsFactor.phone),
									retryAfterMs: smsResendCooldownMs,
									status: 'sent'
								});
							} catch (error) {
								const mapped =
									mapVerificationProviderError(error);
								if (
									mapped?.message ===
									'SMS resend cooldown active'
								)
									return cooldown();
								if (mapped === undefined) throw error;

								return status(mapped.status, mapped.message);
							}
						};
						if (action === 'send') return sendSmsChallenge();

						if (code === undefined) {
							return status('Bad Request', 'SMS code required');
						}
						const localCodeHash = smsEnrollment?.smsPendingCodeHash;
						const challengeId = smsEnrollment?.smsChallengeId;
						const localCodeExpiresAt =
							smsEnrollment?.smsPendingCodeExpiresAt;
						const providerReference =
							smsEnrollment?.smsProviderReference;
						if (
							smsEnrollment?.smsPendingPurpose !==
								'mfa_challenge' ||
							localCodeExpiresAt === undefined ||
							challengeId === undefined
						) {
							return status(
								'Bad Request',
								'No SMS code in progress'
							);
						}
						if (
							verificationProvider === undefined &&
							localCodeHash === undefined
						) {
							return status(
								'Bad Request',
								'No SMS code in progress'
							);
						}
						if (Date.now() > localCodeExpiresAt) {
							return status('Unauthorized', 'SMS code expired');
						}
						if (
							(smsEnrollment?.smsFailedAttempts ?? 0) >=
							smsMaxAttempts
						) {
							await onMfaChallengeError?.({
								error: new Error('mfa_sms_attempts_exceeded'),
								userId: getUserId(user)
							});

							return status('Unauthorized', 'Too many attempts');
						}

						let providerResult;
						if (verificationProvider !== undefined) {
							if (providerReference === undefined) {
								return status(
									'Bad Request',
									'No SMS code in progress'
								);
							}
							const checked = await checkWithVerificationProvider(
								verificationProvider,
								{
									channel: 'sms',
									code,
									purpose: 'mfa_challenge',
									reference: providerReference,
									subject: getUserId(user),
									to: smsFactor.phone
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
						const smsValid = providerResult
							? providerResult.status === 'approved'
							: localCodeHash !== undefined &&
								(await constantTimeEqual(
									await hashToken(code),
									localCodeHash
								));
						if (!smsValid) {
							const attempts = await smsStore.recordSmsFailure({
								challengeId,
								maxAttempts: smsMaxAttempts,
								userId: getUserId(user)
							});
							await onMfaChallengeError?.({
								error: new Error('invalid_mfa_code'),
								userId: getUserId(user)
							});

							return status(
								providerResult?.status ===
									'max_attempts_reached' ||
									attempts === undefined
									? 'Too Many Requests'
									: 'Unauthorized',
								providerResult?.status === 'expired'
									? 'SMS code expired'
									: 'Invalid MFA code'
							);
						}

						const completed = await smsStore.completeSmsChallenge({
							challengeId,
							lastUsedAt: Date.now(),
							smsVerified: true,
							userId: getUserId(user)
						});
						if (!completed) {
							return status(
								'Unauthorized',
								'SMS challenge is no longer active'
							);
						}

						const stillEnrolled =
							await mfaStore.completeCodeChallenge({
								now: Date.now(),
								userId: getUserId(user)
							});

						if (!stillEnrolled)
							return status(
								'Unauthorized',
								'No MFA challenge in progress'
							);

						return promote();
					};

					if (factor === 'sms') return runSmsChallenge();

					if (code === undefined) {
						return status('Unauthorized', 'Invalid MFA code');
					}

					// Unspecified legacy requests select the recovery budget only for non-TOTP-shaped codes.
					const attemptFactor =
						factor === 'backup_codes' ||
						(factor === undefined &&
							factorId === undefined &&
							!/^\d{6}$/.test(code))
							? 'backup_codes'
							: 'totp';
					const maxAttempts =
						attemptFactor === 'backup_codes'
							? backupCodeMaxAttempts
							: totpMaxAttempts;
					const attempt = await mfaStore.claimCodeAttempt({
						factor: attemptFactor,
						maxAttempts,
						now: Date.now(),
						userId: getUserId(user),
						windowMs: codeAttemptWindowMs
					});
					const limited = () => {
						set.headers['Retry-After'] = String(
							Math.ceil(
								attempt.retryAfterMs / MILLISECONDS_IN_A_SECOND
							)
						);

						return status('Too Many Requests', {
							code: 'mfa_rate_limited',
							factor: attemptFactor,
							message: 'Too many verification attempts',
							retryAfterMs: attempt.retryAfterMs
						});
					};
					if (!attempt.allowed) {
						await onMfaChallengeError?.({
							error: new Error('mfa_totp_attempts_exceeded'),
							userId: getUserId(user)
						});

						return limited();
					}

					const totpFactors = factors.filter(
						(candidate): candidate is TotpMfaFactor =>
							candidate.type === 'totp' &&
							candidate.verified &&
							(candidate.id === factorId ||
								factorId === undefined)
					);
					const totpChecks =
						attemptFactor === 'backup_codes'
							? []
							: await Promise.all(
									totpFactors.map(async (candidate) =>
										verifyTotp({
											secret: await decryptTotpSecret(
												candidate.secretCiphertext,
												encryptionKey
											),
											token: code
										})
									)
								);
					const totpValid = totpChecks.some(Boolean);
					const backupCodeHash =
						attemptFactor === 'backup_codes'
							? await hashToken(code)
							: undefined;
					const backupValid =
						backupCodeHash !== undefined &&
						enrollment.backupCodeHashes.includes(backupCodeHash);
					if (!totpValid && !backupValid) {
						await onMfaChallengeError?.({
							error: new Error('invalid_mfa_code'),
							userId: getUserId(user)
						});
						if (attempt.attempts >= maxAttempts) return limited();

						return status('Unauthorized', 'Invalid MFA code');
					}
					const completed = await mfaStore.completeCodeChallenge({
						backupCodeHash,
						now: Date.now(),
						userId: getUserId(user)
					});
					if (!completed)
						return status('Unauthorized', 'Invalid MFA code');
					await mfaStore.resetCodeAttempts({
						attempt,
						factor: attemptFactor,
						userId: getUserId(user)
					});

					return promote();
				})
		);
};
