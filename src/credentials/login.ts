import { Elysia, t } from 'elysia';
import { MILLISECONDS_IN_AN_HOUR } from '../constants';
import { verifyPassword } from '../crypto';
import { createSessionCompatibilityLayer } from '../session/access';
import { persistWhen, promoteToSession } from '../session/promote';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import {
	type CredentialRouteProps,
	DEFAULT_CREDENTIAL_SESSION_TTL_MS
} from './config';

export const credentialsLogin = <UserType>({
	authSessionStore,
	credentialStore,
	getUserByEmail,
	isMfaRequired,
	lockoutGuard,
	loginRoute = '/auth/login',
	onCredentialsLoginError,
	onCredentialsLoginSuccess,
	requireEmailVerification = false,
	sessionDurationMs = DEFAULT_CREDENTIAL_SESSION_TTL_MS
}: CredentialRouteProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).post(
		loginRoute,
		async ({
			body: { email, password },
			cookie: { user_session_id },
			status,
			store: { session, unregisteredSession }
		}) => {
			const normalizedEmail = email.trim().toLowerCase();
			const lockState = lockoutGuard
				? await lockoutGuard.check(normalizedEmail)
				: undefined;
			if (lockState?.locked) {
				return status('Too Many Requests', {
					retryAfterMs: lockState.retryAfterMs,
					status: 'account_locked'
				});
			}

			const credential =
				await credentialStore.getCredentialByEmail(normalizedEmail);
			const user = await getUserByEmail(normalizedEmail);
			const passwordValid = credential
				? await verifyPassword(password, credential.passwordHash)
				: false;

			// One generic failure (message + status) to avoid account enumeration.
			if (
				!credential ||
				!user ||
				credential.status !== 'active' ||
				!passwordValid
			) {
				await lockoutGuard?.recordFailure(normalizedEmail);
				await onCredentialsLoginError?.({
					email: normalizedEmail,
					error: new Error('invalid_credentials')
				});

				return status('Unauthorized', 'Invalid email or password');
			}

			await lockoutGuard?.recordSuccess(normalizedEmail);

			if (requireEmailVerification && !credential.emailVerified) {
				return status('Forbidden', { status: 'email_not_verified' });
			}

			// MFA seam: when a factor is enrolled, keep an unregistered session and
			// defer promotion to the (Workstream B) challenge route.
			if (await isMfaRequired?.(user)) {
				const compatibilityLayer =
					await createSessionCompatibilityLayer({
						authSessionStore,
						userSessionId: user_session_id.value
					});
				const pendingUnregistered = authSessionStore
					? compatibilityLayer.unregisteredSession
					: unregisteredSession;
				const pendingSessionId = crypto.randomUUID();
				pendingUnregistered[pendingSessionId] = {
					expiresAt: Date.now() + MILLISECONDS_IN_AN_HOUR,
					userIdentity: { email: normalizedEmail }
				};
				user_session_id.set({
					httpOnly: true,
					sameSite: 'lax',
					secure: true,
					value: pendingSessionId
				});
				await persistWhen(
					authSessionStore !== undefined,
					compatibilityLayer.persist
				);

				return status('OK', { status: 'mfa_required' });
			}

			const userSessionId = await promoteToSession({
				authSessionStore,
				cookie: user_session_id,
				inMemorySession: session,
				sessionDurationMs,
				user
			});
			await onCredentialsLoginSuccess?.({ user, userSessionId });

			return status('OK', { status: 'authenticated' });
		},
		{
			body: t.Object({ email: t.String(), password: t.String() }),
			cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
		}
	);
