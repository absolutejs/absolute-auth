import { Elysia, t } from 'elysia';
import { createTotpKeyUri, generateTotpSecret, verifyTotp } from '../crypto';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import { generateBackupCodes } from './backupCodes';
import {
	DEFAULT_BACKUP_CODE_COUNT,
	DEFAULT_MFA_ISSUER,
	type MfaRouteProps
} from './config';
import { decryptTotpSecret, encryptTotpSecret } from './secret';

export const mfaTotpRoutes = <UserType>({
	authSessionStore,
	backupCodeCount = DEFAULT_BACKUP_CODE_COUNT,
	encryptionKey,
	getUserId,
	issuer = DEFAULT_MFA_ISSUER,
	mfaStore,
	onMfaEnrolled,
	totpSetupRoute = '/auth/mfa/totp/setup',
	totpVerifyRoute = '/auth/mfa/totp/verify'
}: MfaRouteProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.post(
			totpSetupRoute,
			async ({ cookie: { user_session_id }, status, store: { session } }) => {
				const userSession = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});
				if (!userSession) {
					return status('Unauthorized', 'Authentication required');
				}

				const userId = getUserId(userSession.user);
				const secret = generateTotpSecret();
				const existing = await mfaStore.getEnrollment(userId);
				const now = Date.now();
				await mfaStore.saveEnrollment({
					backupCodeHashes: existing?.backupCodeHashes ?? [],
					createdAt: existing?.createdAt ?? now,
					totpSecretCiphertext: await encryptTotpSecret(
						secret,
						encryptionKey
					),
					totpVerified: false,
					updatedAt: now,
					userId
				});

				return status('OK', {
					secret,
					uri: createTotpKeyUri({ accountName: userId, issuer, secret })
				});
			},
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) }
		)
		.post(
			totpVerifyRoute,
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
				if (!enrollment?.totpSecretCiphertext) {
					return status('Bad Request', 'No TOTP enrollment in progress');
				}

				const secret = await decryptTotpSecret(
					enrollment.totpSecretCiphertext,
					encryptionKey
				);
				const valid = await verifyTotp({ secret, token: code });
				if (!valid) {
					return status('Bad Request', 'Invalid TOTP code');
				}

				const { codes, hashes } =
					await generateBackupCodes(backupCodeCount);
				await mfaStore.saveEnrollment({
					...enrollment,
					backupCodeHashes: hashes,
					totpVerified: true,
					updatedAt: Date.now()
				});
				await onMfaEnrolled?.({ userId });

				return status('OK', { backupCodes: codes });
			},
			{
				body: t.Object({ code: t.String() }),
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
			}
		);
