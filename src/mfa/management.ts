import { Elysia, t } from 'elysia';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import {
	DEFAULT_MFA_MANAGEMENT_AUTH_MAX_AGE_MS,
	type MfaRouteProps
} from './config';
import { hasRecentAuthentication } from './recentAuth';
import { isMfaEnrolled } from './types';

export type MfaStatus = {
	backupCodesRemaining: number;
	enabled: boolean;
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
					smsBackup: {
						enabled: enrollment?.smsVerified ?? false,
						phone: maskPhone(enrollment?.smsPhone)
					},
					totp: { enabled: enrollment?.totpVerified ?? false }
				};

				return status('OK', response);
			},
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) }
		)
		.delete(
			managementRoute,
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
			},
			{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) }
		);
