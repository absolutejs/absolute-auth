import { Elysia, t } from 'elysia';
import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { loadSessionFromSource } from '../session/access';
import { promoteToSession } from '../session/promote';
import { sessionStore } from '../session/state';
import { isNonEmptyString } from '../typeGuards';
import { userSessionIdTypebox } from '../typebox';
import {
	DEFAULT_WEBAUTHN_CHALLENGE_TTL_MS,
	DEFAULT_WEBAUTHN_ROUTE,
	DEFAULT_WEBAUTHN_SESSION_TTL_MS,
	type WebAuthnRouteProps
} from './config';

// The WebAuthn ceremonies. Registration adds a passkey to the already-authenticated caller;
// authentication is passwordless sign-in. The short-lived `webauthn_challenge` cookie binds an
// options request to its verify request (single-use, cleared on verify). `auth()` mounts this
// before `protectRoutePlugin` when a `webauthn` block is configured.
export const webauthnRoutes = <UserType>({
	authSessionStore,
	challengeDurationMs = DEFAULT_WEBAUTHN_CHALLENGE_TTL_MS,
	credentialStore,
	emit,
	getUserDisplayName,
	getUserId,
	getUserName,
	getWebAuthnUser,
	onWebAuthnAuthenticated,
	onWebAuthnRegistered,
	origin,
	rpId,
	rpName,
	sessionDurationMs = DEFAULT_WEBAUTHN_SESSION_TTL_MS,
	webauthnAdapter,
	webauthnRoute = DEFAULT_WEBAUTHN_ROUTE
}: WebAuthnRouteProps<UserType>) => {
	const challengeCookie = t.Cookie({
		user_session_id: t.Optional(userSessionIdTypebox),
		webauthn_challenge: t.Optional(t.String())
	});
	const setChallenge = (
		cookie: { set: (options: Record<string, unknown>) => void },
		challenge: string
	) =>
		cookie.set({
			httpOnly: true,
			maxAge: Math.floor(challengeDurationMs / MILLISECONDS_IN_A_SECOND),
			sameSite: 'lax',
			secure: true,
			value: challenge
		});

	return new Elysia()
		.use(sessionStore<UserType>())
		.post(
			`${webauthnRoute}/register/options`,
			async ({
				cookie: { user_session_id, webauthn_challenge },
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

				const { user } = userSession;
				const userId = getUserId(user);
				const existing =
					await credentialStore.listCredentialsByUser(userId);
				const { challenge, options } =
					await webauthnAdapter.createRegistrationOptions({
						excludeCredentials: existing.map((credential) => ({
							id: credential.credentialId,
							transports: credential.transports
						})),
						rpId,
						rpName,
						userDisplayName: getUserDisplayName?.(user) ?? userId,
						userId,
						userName: getUserName?.(user) ?? userId
					});
				setChallenge(webauthn_challenge, challenge);

				return status('OK', options);
			},
			{ cookie: challengeCookie }
		)
		.post(
			`${webauthnRoute}/register/verify`,
			async ({
				body,
				cookie: { user_session_id, webauthn_challenge },
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

				const expectedChallenge = webauthn_challenge.value;
				if (!isNonEmptyString(expectedChallenge)) {
					return status(
						'Bad Request',
						'No registration challenge in progress'
					);
				}

				const result = await webauthnAdapter.verifyRegistration({
					expectedChallenge,
					expectedOrigin: origin,
					expectedRPID: rpId,
					response: body
				});
				webauthn_challenge.remove();
				if (!result.verified || !result.credential) {
					return status(
						'Bad Request',
						'WebAuthn registration failed'
					);
				}

				const userId = getUserId(userSession.user);
				await credentialStore.saveCredential({
					...result.credential,
					createdAt: Date.now(),
					userId
				});
				await emit?.({
					at: Date.now(),
					metadata: { credentialId: result.credential.credentialId },
					type: 'webauthn_registered',
					userId
				});
				await onWebAuthnRegistered?.({
					credentialId: result.credential.credentialId,
					userId
				});

				return status('OK', {
					credentialId: result.credential.credentialId,
					verified: true
				});
			},
			{
				body: t.Object({}, { additionalProperties: true }),
				cookie: challengeCookie
			}
		)
		.post(
			`${webauthnRoute}/authenticate/options`,
			async ({ cookie: { webauthn_challenge }, status }) => {
				const { challenge, options } =
					await webauthnAdapter.createAuthenticationOptions({
						allowCredentials: [],
						rpId
					});
				setChallenge(webauthn_challenge, challenge);

				return status('OK', options);
			},
			{ cookie: challengeCookie }
		)
		.post(
			`${webauthnRoute}/authenticate/verify`,
			async ({
				body,
				cookie: { user_session_id, webauthn_challenge },
				status,
				store: { session }
			}) => {
				const expectedChallenge = webauthn_challenge.value;
				if (!isNonEmptyString(expectedChallenge)) {
					return status(
						'Bad Request',
						'No authentication challenge in progress'
					);
				}

				const credential = await credentialStore.getCredential(body.id);
				if (!credential) {
					return status('Unauthorized', 'Unknown credential');
				}

				const result = await webauthnAdapter.verifyAuthentication({
					credential: {
						counter: credential.counter,
						credentialId: credential.credentialId,
						publicKey: credential.publicKey,
						transports: credential.transports
					},
					expectedChallenge,
					expectedOrigin: origin,
					expectedRPID: rpId,
					response: body
				});
				webauthn_challenge.remove();
				if (!result.verified) {
					return status(
						'Unauthorized',
						'WebAuthn authentication failed'
					);
				}

				const user = await getWebAuthnUser(credential.userId);
				if (!user) {
					return status(
						'Unauthorized',
						'WebAuthn authentication failed'
					);
				}

				await credentialStore.saveCredential({
					...credential,
					counter: result.newCounter ?? credential.counter,
					lastUsedAt: Date.now()
				});
				const userSessionId = await promoteToSession({
					authSessionStore,
					cookie: user_session_id,
					inMemorySession: session,
					sessionDurationMs,
					user
				});
				await emit?.({
					at: Date.now(),
					type: 'webauthn_authenticated',
					userId: credential.userId
				});
				await onWebAuthnAuthenticated?.({ user, userSessionId });

				return status('OK', { status: 'authenticated' });
			},
			{
				body: t.Object(
					{ id: t.String() },
					{ additionalProperties: true }
				),
				cookie: challengeCookie
			}
		);
};
