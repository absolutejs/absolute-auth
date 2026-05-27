import { Elysia, t } from 'elysia';
import { generateSecureToken, hashPassword, hashToken } from '../crypto';
import { sessionStore } from '../session/state';
import { isStatusResponse } from '../typeGuards';
import { userSessionIdTypebox } from '../typebox';
import {
	type CredentialRouteProps,
	DEFAULT_CREDENTIAL_SESSION_TTL_MS,
	DEFAULT_VERIFICATION_TOKEN_TTL_MS
} from './config';
import { promoteToSession } from '../session/promote';
import { evaluatePassword } from './passwordPolicy';

export const credentialsRegister = <UserType>({
	authSessionStore,
	cookieSecure,
	credentialStore,
	onCreateCredentialUser,
	onCredentialsLoginSuccess,
	onRegistrationSuccess,
	onSendEmail,
	passwordPolicy,
	registerRoute = '/auth/register',
	requireEmailVerification = false,
	sessionDurationMs = DEFAULT_CREDENTIAL_SESSION_TTL_MS,
	verificationTokenDurationMs = DEFAULT_VERIFICATION_TOKEN_TTL_MS
}: CredentialRouteProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).post(
		registerRoute,
		async ({
			body: { email, password, ...extraFields },
			cookie: { user_session_id },
			status,
			store: { session }
		}) => {
			const normalizedEmail = email.trim().toLowerCase();
			if (!normalizedEmail.includes('@')) {
				return status('Bad Request', 'A valid email is required');
			}

			const policy = await evaluatePassword(password, passwordPolicy);
			if (!policy.ok) {
				return status('Bad Request', {
					message: 'Password does not meet the policy',
					violations: policy.violations
				});
			}

			const existing =
				await credentialStore.getCredentialByEmail(normalizedEmail);
			if (existing) {
				return status('Conflict', 'Email is already registered');
			}

			const created = await onCreateCredentialUser({
				...extraFields,
				email: normalizedEmail
			});
			if (created instanceof Response || isStatusResponse(created)) {
				return created;
			}

			const now = Date.now();
			await credentialStore.saveCredential({
				createdAt: now,
				email: normalizedEmail,
				emailVerified: false,
				passwordHash: await hashPassword(password),
				status: 'active',
				updatedAt: now
			});

			const token = generateSecureToken();
			const expiresAt = now + verificationTokenDurationMs;
			await credentialStore.saveVerificationToken({
				email: normalizedEmail,
				expiresAt,
				tokenHash: await hashToken(token)
			});
			await onSendEmail({
				email: normalizedEmail,
				expiresAt,
				token,
				type: 'verify_email'
			});
			await onRegistrationSuccess?.({
				email: normalizedEmail,
				user: created
			});

			if (requireEmailVerification) {
				return status('Created', { status: 'verification_required' });
			}

			// Auto-login. A freshly registered user has no enrolled factors yet, so the
			// MFA seam (enforced on subsequent logins) does not apply here.
			const userSessionId = await promoteToSession({
				authSessionStore,
				cookie: user_session_id,
				cookieSecure,
				inMemorySession: session,
				sessionDurationMs,
				user: created
			});
			await onCredentialsLoginSuccess?.({ user: created, userSessionId });

			return status('Created', { status: 'authenticated' });
		},
		{
			// `additionalProperties` lets extra signup fields (e.g. given_name)
			// flow through to onCreateCredentialUser for profile capture.
			body: t.Object(
				{ email: t.String(), password: t.String() },
				{ additionalProperties: true }
			),
			cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
		}
	);
