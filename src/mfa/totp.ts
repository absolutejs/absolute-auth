import { Elysia, t } from 'elysia';
import { createTotpKeyUri, generateTotpSecret, verifyTotp } from '../crypto';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import { generateBackupCodes } from './backupCodes';
import {
	DEFAULT_BACKUP_CODE_COUNT,
	DEFAULT_MFA_ISSUER,
	DEFAULT_MFA_MANAGEMENT_AUTH_MAX_AGE_MS,
	type MfaRouteProps
} from './config';
import { decryptTotpSecret, encryptTotpSecret } from './secret';
import { hasRecentAuthentication } from './recentAuth';
import {
	getMfaFactors,
	type TotpMfaFactor,
	withMfaFactors
} from './types';

const FACTOR_LABEL_MAX_LENGTH = 80;
const DEFAULT_TOTP_LABEL = 'Authenticator app';

export const mfaTotpRoutes = <UserType>({
	authSessionStore,
	backupCodeCount = DEFAULT_BACKUP_CODE_COUNT,
	encryptionKey,
	getUserId,
	issuer = DEFAULT_MFA_ISSUER,
	managementAuthMaxAgeMs = DEFAULT_MFA_MANAGEMENT_AUTH_MAX_AGE_MS,
	mfaStore,
	onMfaEnrolled,
	totpSetupRoute = '/auth/mfa/totp/setup',
	totpVerifyRoute = '/auth/mfa/totp/verify'
}: MfaRouteProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.post(
			totpSetupRoute,
			{
				body: t.Object({
					label: t.Optional(
						t.String({ maxLength: FACTOR_LABEL_MAX_LENGTH })
					)
				}),
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
			},
			async ({
				body: { label },
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
				const secret = generateTotpSecret();
				const existing = await mfaStore.getEnrollment(userId);
				const now = Date.now();
				const base = existing ?? {
					backupCodeHashes: [],
					createdAt: now,
					smsVerified: false,
					totpVerified: false,
					updatedAt: now,
					userId
				};
				const factor: TotpMfaFactor = {
					id: crypto.randomUUID(),
					label: label?.trim() || DEFAULT_TOTP_LABEL,
					secretCiphertext: await encryptTotpSecret(
						secret,
						encryptionKey
					),
					type: 'totp',
					verified: false
				};
				const factors = getMfaFactors(base).filter(
					(existingFactor) =>
						existingFactor.type !== 'totp' ||
						existingFactor.verified
				);
				await mfaStore.saveEnrollment(
					withMfaFactors(
						{ ...base, updatedAt: now },
						[...factors, factor]
					)
				);

				return status('OK', {
					factorId: factor.id,
					secret,
					uri: createTotpKeyUri({
						accountName: userId,
						issuer,
						secret
					})
				});
			}
		)
		.post(
			totpVerifyRoute,
			{
				body: t.Object({
					code: t.String(),
					factorId: t.Optional(t.String())
				}),
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
			},
			async ({
				body: { code, factorId },
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
				if (!enrollment) {
					return status(
						'Bad Request',
						'No TOTP enrollment in progress'
					);
				}
				const factors = getMfaFactors(enrollment);
				const factor = factors.find(
					(candidate) =>
						candidate.type === 'totp' &&
						(candidate.id === factorId ||
							(factorId === undefined && !candidate.verified))
				);
				if (!factor || factor.type !== 'totp') {
					return status(
						'Bad Request',
						'No TOTP enrollment in progress'
					);
				}

				const secret = await decryptTotpSecret(
					factor.secretCiphertext,
					encryptionKey
				);
				const valid = await verifyTotp({ secret, token: code });
				if (!valid) {
					return status('Bad Request', 'Invalid TOTP code');
				}

				const { codes, hashes } =
					await generateBackupCodes(backupCodeCount);
				const verifiedFactors = factors.map((candidate) =>
					candidate.id === factor.id
						? { ...candidate, verified: true }
						: candidate
				);
				await mfaStore.saveEnrollment(
					withMfaFactors(
						{
							...enrollment,
							backupCodeHashes: hashes,
							updatedAt: Date.now()
						},
						verifiedFactors
					)
				);
				await onMfaEnrolled?.({ userId });

				return status('OK', { backupCodes: codes });
			}
		);
