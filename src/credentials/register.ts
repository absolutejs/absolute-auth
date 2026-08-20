import { Elysia, t } from 'elysia';
import { generateSecureToken, hashPassword, hashToken } from '../crypto';
import { resolveOriginAllowed } from '../csrf';
import { sessionStore } from '../session/state';
import { isStatusResponse } from '../typeGuards';
import { userSessionIdTypebox } from '../typebox';
import {
	type CredentialRouteProps,
	DEFAULT_CREDENTIAL_SESSION_TTL_MS,
	DEFAULT_VERIFICATION_TOKEN_TTL_MS
} from './config';
import { promoteToSession } from '../session/promote';
import { withSpan } from '../telemetry/tracing';
import { evaluatePassword } from './passwordPolicy';

export const credentialsRegister = <UserType>({
	authSessionStore,
	cookieSecure,
	credentialStore,
	enforceTrustedOrigins,
	getUserByEmail,
	onCreateCredentialUser,
	onCredentialsLoginSuccess,
	onExistingAccount,
	onRegistrationSuccess,
	onSendEmail,
	onUntrustedOrigin,
	passwordPolicy,
	registerRoute = '/auth/register',
	requireEmailVerification = false,
	revealRegistrationConflicts = false,
	sessionDurationMs = DEFAULT_CREDENTIAL_SESSION_TTL_MS,
	trustedOrigins,
	verificationTokenDurationMs = DEFAULT_VERIFICATION_TOKEN_TTL_MS
}: CredentialRouteProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).post(
		registerRoute,
		{
			// `additionalProperties` lets extra signup fields (e.g. given_name)
			// flow through to onCreateCredentialUser for profile capture.
			body: t.Object(
				{ email: t.String(), password: t.String() },
				{ additionalProperties: true }
			),
			cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
		},
		async ({
			body: { email, password, ...extraFields },
			cookie: { user_session_id },
			request,
			status,
			store: { session }
		}) =>
			withSpan('auth.credentials.register', undefined, async () => {
				if (
					!(await resolveOriginAllowed({
						enforce: enforceTrustedOrigins,
						onUntrustedOrigin,
						request,
						trustedOrigins
					}))
				) {
					return status('Forbidden', 'Request origin is not allowed');
				}
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

				// The credential store is not the canonical account store: OAuth,
				// SSO, SCIM, and passwordless users can legitimately have an account
				// without a password credential. Check both stores before creating a
				// user so those accounts follow the same enumeration-safe path instead
				// of reaching the consumer's create hook and commonly failing as a 500.
				const [existingCredential, existingUser] = await Promise.all([
					credentialStore.getCredentialByEmail(normalizedEmail),
					getUserByEmail(normalizedEmail)
				]);
				if (existingCredential || existingUser) {
					if (revealRegistrationConflicts) {
						return status(
							'Conflict',
							'Email is already registered'
						);
					}
					// Enumeration-safe default: never confirm an account exists.
					// Nudge the real owner out-of-band and return the same generic
					// response a new registration awaiting verification returns, so
					// an attacker can't tell registered emails from new ones. (Full
					// indistinguishability assumes requireEmailVerification=true; see
					// the config docs.)
					await onExistingAccount?.({ email: normalizedEmail });

					return status('Created', {
						status: 'verification_required'
					});
				}

				// A verification-required signup is not an account yet. Persist only
				// the credential and non-secret signup fields; the verification route
				// invokes the consumer's user-creation hook after proving inbox access.
				let created: UserType | undefined;
				if (!requireEmailVerification) {
					const result = await onCreateCredentialUser({
						...extraFields,
						email: normalizedEmail
					});
					if (
						result instanceof Response ||
						isStatusResponse(result)
					) {
						return result;
					}
					created = result;
				}

				const now = Date.now();
				await credentialStore.saveCredential({
					createdAt: now,
					email: normalizedEmail,
					emailVerified: false,
					passwordHash: await hashPassword(password),
					registrationData: requireEmailVerification
						? extraFields
						: undefined,
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
				if (requireEmailVerification) {
					return status('Created', {
						status: 'verification_required'
					});
				}

				// `created` is guaranteed in the immediate-account branch above.
				if (created === undefined) {
					throw new Error('Credential user was not created');
				}
				await onRegistrationSuccess?.({
					email: normalizedEmail,
					user: created
				});

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
				await onCredentialsLoginSuccess?.({
					user: created,
					userSessionId
				});

				return status('Created', { status: 'authenticated' });
			})
	);
