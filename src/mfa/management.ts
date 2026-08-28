import { Elysia, t } from 'elysia';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import {
	DEFAULT_MFA_MANAGEMENT_AUTH_MAX_AGE_MS,
	type MfaRouteProps
} from './config';
import { hasRecentAuthentication } from './recentAuth';
import {
	getMfaFactors,
	isMfaEnrolled,
	type MfaFactorType,
	withMfaFactors
} from './types';

export type MfaPublicFactor = {
	id: string;
	label: string;
	phone: string | null;
	type: Exclude<MfaFactorType, 'backup_codes'>;
};

export type MfaStatus = {
	backupCodesRemaining: number;
	enabled: boolean;
	factors: MfaPublicFactor[];
	smsBackup: {
		enabled: boolean;
		phone: string | null;
	};
	totp: { enabled: boolean };
};

const maskPhone = (phone: string | undefined) => {
	if (!phone) return null;
	const visibleDigits = 4;
	const suffix = phone.slice(-visibleDigits);

	return `${'*'.repeat(Math.max(0, phone.length - visibleDigits))}${suffix}`;
};

const publicFactors = (
	enrollment: Parameters<typeof getMfaFactors>[0] | undefined
) =>
	enrollment
		? getMfaFactors(enrollment)
				.filter((factor) => factor.verified)
				.map((factor) => ({
					id: factor.id,
					label: factor.label,
					phone: factor.type === 'sms' ? maskPhone(factor.phone) : null,
					type: factor.type
				}))
		: [];

export const mfaManagementRoutes = <UserType>({
	authSessionStore,
	getUserId,
	managementRoute = '/auth/mfa',
	managementAuthMaxAgeMs = DEFAULT_MFA_MANAGEMENT_AUTH_MAX_AGE_MS,
	mfaStore
}: MfaRouteProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.get(
			managementRoute,
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) },
			async ({
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

				const enrollment = await mfaStore.getEnrollment(
					getUserId(userSession.user)
				);
				const response: MfaStatus = {
					backupCodesRemaining:
						enrollment?.backupCodeHashes.length ?? 0,
					enabled: isMfaEnrolled(enrollment),
					factors: publicFactors(enrollment),
					smsBackup: {
						enabled: enrollment?.smsVerified ?? false,
						phone: maskPhone(enrollment?.smsPhone)
					},
					totp: { enabled: enrollment?.totpVerified ?? false }
				};

				return status('OK', response);
			}
		)
		.delete(
			managementRoute,
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) },
			async ({
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

				await mfaStore.removeEnrollment(getUserId(userSession.user));

				return status('OK', { status: 'disabled' as const });
			}
		)
		.delete(
			`${managementRoute}/factors/:factorId`,
			{
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox }),
				params: t.Object({ factorId: t.String() })
			},
			async ({
				cookie: { user_session_id },
				params: { factorId },
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
					return status('Not Found', 'MFA factor not found');
				}
				const factors = getMfaFactors(enrollment);
				if (!factors.some((factor) => factor.id === factorId)) {
					return status('Not Found', 'MFA factor not found');
				}
				const remaining = factors.filter(
					(factor) => factor.id !== factorId
				);
				if (remaining.length === 0) {
					await mfaStore.removeEnrollment(userId);
				} else {
					const hasVerifiedFactor = remaining.some(
						(factor) => factor.verified
					);
					await mfaStore.saveEnrollment(
						withMfaFactors(
							{
								...enrollment,
								backupCodeHashes: hasVerifiedFactor
									? enrollment.backupCodeHashes
									: [],
								updatedAt: Date.now()
							},
							remaining
						)
					);
				}

				return status('OK', { status: 'removed' as const });
			}
		);
