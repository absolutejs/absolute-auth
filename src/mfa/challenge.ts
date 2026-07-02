import { Elysia, t } from 'elysia';
import { constantTimeEqual, hashToken, verifyTotp } from '../crypto';
import { createSessionCompatibilityLayer } from '../session/access';
import { persistWhen } from '../session/promote';
import { sessionStore } from '../session/state';
import { withSpan } from '../telemetry/tracing';
import { userSessionIdTypebox } from '../typebox';
import { resolveCookieSecure } from '../utils';
import { consumeBackupCode } from './backupCodes';
import {
	DEFAULT_MFA_SESSION_TTL_MS,
	DEFAULT_SMS_CODE_LENGTH,
	DEFAULT_SMS_CODE_TTL_MS,
	DEFAULT_SMS_MAX_ATTEMPTS,
	DEFAULT_TOTP_MAX_ATTEMPTS,
	type MfaRouteProps
} from './config';
import { decryptTotpSecret } from './secret';
import { issueAndStoreSmsCode } from './sms';

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
	sessionDurationMs = DEFAULT_MFA_SESSION_TTL_MS,
	smsCodeLength = DEFAULT_SMS_CODE_LENGTH,
	smsCodeTtlMs = DEFAULT_SMS_CODE_TTL_MS,
	smsMaxAttempts = DEFAULT_SMS_MAX_ATTEMPTS,
	totpMaxAttempts = DEFAULT_TOTP_MAX_ATTEMPTS
}: MfaRouteProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).post(
		challengeRoute,
		async ({
			body: { action, code, factor },
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
				if (!pendingId || !pending) {
					return status(
						'Unauthorized',
						'No MFA challenge in progress'
					);
				}

				const user = await getChallengeUser(pending.userIdentity ?? {});
				const enrollment = user
					? await mfaStore.getEnrollment(getUserId(user))
					: undefined;
				if (!user || !enrollment) {
					return status(
						'Unauthorized',
						'No MFA challenge in progress'
					);
				}

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
					if (!enrollment.smsVerified || !enrollment.smsPhone) {
						return status(
							'Unauthorized',
							'No MFA challenge in progress'
						);
					}

					if (action === 'send') {
						await issueAndStoreSmsCode({
							codeLength: smsCodeLength,
							enrollment,
							mfaStore,
							onSendSmsCode,
							ttlMs: smsCodeTtlMs
						});

						return status('OK', { status: 'sent' });
					}

					if (code === undefined) {
						return status('Bad Request', 'SMS code required');
					}
					if (
						!enrollment.smsPendingCodeHash ||
						enrollment.smsPendingCodeExpiresAt === undefined
					) {
						return status('Bad Request', 'No SMS code in progress');
					}
					if (Date.now() > enrollment.smsPendingCodeExpiresAt) {
						return status('Unauthorized', 'SMS code expired');
					}
					if ((enrollment.smsFailedAttempts ?? 0) >= smsMaxAttempts) {
						await onMfaChallengeError?.({
							error: new Error('mfa_sms_attempts_exceeded'),
							userId: getUserId(user)
						});

						return status('Unauthorized', 'Too many attempts');
					}

					const smsValid = await constantTimeEqual(
						await hashToken(code),
						enrollment.smsPendingCodeHash
					);
					if (!smsValid) {
						await mfaStore.saveEnrollment({
							...enrollment,
							smsFailedAttempts:
								(enrollment.smsFailedAttempts ?? 0) + 1,
							updatedAt: Date.now()
						});
						await onMfaChallengeError?.({
							error: new Error('invalid_mfa_code'),
							userId: getUserId(user)
						});

						return status('Unauthorized', 'Invalid MFA code');
					}

					await mfaStore.saveEnrollment({
						...enrollment,
						lastUsedAt: Date.now(),
						smsFailedAttempts: 0,
						smsPendingCodeExpiresAt: undefined,
						smsPendingCodeHash: undefined,
						updatedAt: Date.now()
					});

					return promote();
				};

				if (factor === 'sms') return runSmsChallenge();

				if (code === undefined) {
					return status('Unauthorized', 'Invalid MFA code');
				}

				if ((enrollment.totpFailedAttempts ?? 0) >= totpMaxAttempts) {
					await onMfaChallengeError?.({
						error: new Error('mfa_totp_attempts_exceeded'),
						userId: getUserId(user)
					});

					return status('Unauthorized', 'Too many attempts');
				}

				const totpValid =
					enrollment.totpVerified && enrollment.totpSecretCiphertext
						? await verifyTotp({
								secret: await decryptTotpSecret(
									enrollment.totpSecretCiphertext,
									encryptionKey
								),
								token: code
							})
						: false;
				const remainingBackupHashes = totpValid
					? undefined
					: await consumeBackupCode(
							code,
							enrollment.backupCodeHashes
						);

				if (!totpValid && remainingBackupHashes === undefined) {
					await mfaStore.saveEnrollment({
						...enrollment,
						totpFailedAttempts:
							(enrollment.totpFailedAttempts ?? 0) + 1,
						updatedAt: Date.now()
					});
					await onMfaChallengeError?.({
						error: new Error('invalid_mfa_code'),
						userId: getUserId(user)
					});

					return status('Unauthorized', 'Invalid MFA code');
				}

				await mfaStore.saveEnrollment({
					...enrollment,
					backupCodeHashes:
						remainingBackupHashes ?? enrollment.backupCodeHashes,
					lastUsedAt: Date.now(),
					totpFailedAttempts: 0,
					updatedAt: Date.now()
				});

				return promote();
			}),
		{
			body: t.Object({
				action: t.Optional(
					t.Union([t.Literal('send'), t.Literal('verify')])
				),
				code: t.Optional(t.String()),
				factor: t.Optional(t.Literal('sms'))
			}),
			cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
		}
	);
