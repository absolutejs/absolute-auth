import { Elysia, t } from 'elysia';
import { MILLISECONDS_IN_AN_HOUR } from '../constants';
import { verifyPassword } from '../crypto';
import { rehashCredentialPassword } from './import';
import { isLegacyHash } from './legacyHashers';
import { createSessionCompatibilityLayer } from '../session/access';
import { persistWhen, promoteToSession } from '../session/promote';
import { sessionStore } from '../session/state';
import { withSpan } from '../telemetry/tracing';
import { userSessionIdTypebox } from '../typebox';
import { resolveCookieSecure } from '../utils';
import {
	type CredentialRouteProps,
	DEFAULT_CREDENTIAL_SESSION_TTL_MS
} from './config';
import { isPasswordCompromised } from './passwordPolicy';

export const credentialsLogin = <UserType>({
	authSessionStore,
	checkBreachesOnLogin,
	cookieSecure,
	credentialStore,
	getUserByEmail,
	isMfaRequired,
	lockoutGuard,
	loginRoute = '/auth/login',
	onCredentialsLoginError,
	onCredentialsLoginSuccess,
	passwordVerifier,
	rehashOnLogin = false,
	requireEmailVerification = false,
	sessionDurationMs = DEFAULT_CREDENTIAL_SESSION_TTL_MS
}: CredentialRouteProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).post(
		loginRoute,
		async ({
			body: { email, password },
			cookie: { user_session_id },
			request,
			status,
			store: { session, unregisteredSession }
		}) =>
			withSpan('auth.credentials.login', undefined, async (span) => {
				// Build the loose request-context bag we expose to `isMfaRequired` so
				// the consumer can adapt the gate per-request (e.g. plug in `scoreRisk`).
				const headerBag: Record<string, string | undefined> = {};
				request.headers.forEach((value, key) => {
					headerBag[key] = value;
				});
				const mfaContext: {
					headers: Record<string, string | undefined>;
					ip?: string;
				} = {
					headers: headerBag,
					// IP resolution priority: Cloudflare's `cf-connecting-ip` (when CF
					// reaches us directly), DigitalOcean App Platform's `do-connecting-ip`
					// (CF→DO drops cf-* but DO substitutes its own), then the first
					// `x-forwarded-for` entry as a generic fallback.
					ip:
						headerBag['cf-connecting-ip'] ??
						headerBag['do-connecting-ip'] ??
						headerBag['x-forwarded-for']?.split(',')[0]?.trim() ??
						undefined
				};
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
				// `passwordVerifier` overrides the default Bun verify when configured —
				// the consumer routes to legacy-hash verifiers (Auth0 PBKDF2, Cognito
				// SHA-256, etc.) and still falls back to Bun for argon2id+bcrypt.
				const verifyHash = passwordVerifier ?? verifyPassword;
				const passwordValid =
					credential === undefined
						? false
						: await verifyHash(password, credential.passwordHash);

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
				// Note: consumers can attach an `auth.user.sub` attribute from inside
				// their `onCredentialsLoginSuccess` hook by wrapping with `withSpan`;
				// we can't safely access UserType-internal fields from generic code.
				void span;

				// Migration upgrade path: imported users that came in with a non-native
				// hash (Auth0 PBKDF2, Cognito SHA-256, custom scrypt, etc.) get their
				// password re-hashed with Argon2id on first successful login, so the next
				// login uses the package's native verify path.
				if (rehashOnLogin && isLegacyHash(credential.passwordHash)) {
					await rehashCredentialPassword({
						credentialStore,
						current: credential,
						plainPassword: password
					});
				}

				if (requireEmailVerification && !credential.emailVerified) {
					return status('Forbidden', {
						status: 'email_not_verified'
					});
				}

				// MFA seam: when a factor is enrolled OR adaptive risk says so, keep an
				// unregistered session and defer promotion to the (Workstream B) challenge route.
				if (await isMfaRequired?.(user, mfaContext)) {
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
						secure: resolveCookieSecure(cookieSecure),
						value: pendingSessionId
					});
					await persistWhen(
						authSessionStore !== undefined,
						compatibilityLayer.persist
					);

					return status('OK', { status: 'mfa_required' });
				}

				// Login-time breach check: never block (the user is already verified),
				// just flag so the consumer can prompt a reset on next screen.
				const passwordCompromised = checkBreachesOnLogin
					? await isPasswordCompromised(password)
					: false;

				const userSessionId = await promoteToSession({
					authSessionStore,
					cookie: user_session_id,
					cookieSecure,
					inMemorySession: session,
					sessionDurationMs,
					user
				});
				await onCredentialsLoginSuccess?.({ user, userSessionId });

				return status('OK', {
					passwordCompromised,
					status: 'authenticated'
				});
			}),
		{
			body: t.Object({ email: t.String(), password: t.String() }),
			cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
		}
	);
