import { Elysia, t } from 'elysia';
import { verifyTotp } from '../crypto';
import { createSessionCompatibilityLayer } from '../session/access';
import { persistWhen } from '../session/promote';
import { sessionStore } from '../session/state';
import { withSpan } from '../telemetry/tracing';
import { userSessionIdTypebox } from '../typebox';
import { resolveCookieSecure } from '../utils';
import { consumeBackupCode } from './backupCodes';
import { DEFAULT_MFA_SESSION_TTL_MS, type MfaRouteProps } from './config';
import { decryptTotpSecret } from './secret';

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
	sessionDurationMs = DEFAULT_MFA_SESSION_TTL_MS
}: MfaRouteProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).post(
		challengeRoute,
		async ({
			body: { code },
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
					updatedAt: Date.now()
				});

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
			}),
		{
			body: t.Object({ code: t.String() }),
			cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
		}
	);
