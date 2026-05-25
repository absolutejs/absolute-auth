import { Elysia, t } from 'elysia';
import { MILLISECONDS_IN_AN_HOUR } from '../constants';
import { generateSecureToken, verifyPassword } from '../crypto';
import { createSessionCompatibilityLayer } from '../session/access';
import { sessionStore } from '../session/state';
import type { AuthSessionStore } from '../session/types';
import { userSessionIdTypebox } from '../typebox';
import {
	type CredentialsConfig,
	DEFAULT_CREDENTIAL_SESSION_TTL_MS
} from './config';

type CredentialsLoginProps<UserType> = CredentialsConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
};

const persistWhen = async (
	shouldPersist: boolean,
	persist: () => Promise<void>
) => {
	if (shouldPersist) await persist();
};

export const credentialsLogin = <UserType>({
	authSessionStore,
	credentialStore,
	getUserByEmail,
	isMfaRequired,
	loginRoute = '/auth/login',
	onCredentialsLoginError,
	onCredentialsLoginSuccess,
	sessionDurationMs = DEFAULT_CREDENTIAL_SESSION_TTL_MS
}: CredentialsLoginProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).post(
		loginRoute,
		async ({
			body: { email, password },
			cookie: { user_session_id },
			status,
			store: { session, unregisteredSession }
		}) => {
			const normalizedEmail = email.trim().toLowerCase();
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
				await onCredentialsLoginError?.({
					email: normalizedEmail,
					error: new Error('invalid_credentials')
				});

				return status('Unauthorized', 'Invalid email or password');
			}

			const compatibilityLayer = await createSessionCompatibilityLayer({
				authSessionStore,
				userSessionId: user_session_id.value
			});
			const loginSession = authSessionStore
				? compatibilityLayer.session
				: session;
			const loginUnregistered = authSessionStore
				? compatibilityLayer.unregisteredSession
				: unregisteredSession;
			const userSessionId = crypto.randomUUID();

			// MFA seam: when a factor is enrolled, keep an unregistered session and
			// defer promotion to the (Workstream B) challenge route.
			if (await isMfaRequired?.(user)) {
				loginUnregistered[userSessionId] = {
					expiresAt: Date.now() + MILLISECONDS_IN_AN_HOUR,
					userIdentity: { email: normalizedEmail }
				};
				user_session_id.set({
					httpOnly: true,
					sameSite: 'lax',
					secure: true,
					value: userSessionId
				});
				await persistWhen(
					authSessionStore !== undefined,
					compatibilityLayer.persist
				);

				return status('OK', { status: 'mfa_required' });
			}

			loginSession[userSessionId] = {
				accessToken: generateSecureToken(),
				expiresAt: Date.now() + sessionDurationMs,
				user
			};
			user_session_id.set({
				httpOnly: true,
				sameSite: 'lax',
				secure: true,
				value: userSessionId
			});
			await persistWhen(
				authSessionStore !== undefined,
				compatibilityLayer.persist
			);
			await onCredentialsLoginSuccess?.({ user, userSessionId });

			return status('OK', { status: 'authenticated' });
		},
		{
			body: t.Object({ email: t.String(), password: t.String() }),
			cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
		}
	);
