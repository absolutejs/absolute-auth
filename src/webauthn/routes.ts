import { createInMemoryWebAuthnChallengeStore } from './challengeStore';
import { Elysia, t } from 'elysia';
import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { loadSessionFromSource } from '../session/access';
import { promoteToSession } from '../session/promote';
import { sessionStore } from '../session/state';
import { isNonEmptyString } from '../typeGuards';
import { userSessionIdTypebox } from '../typebox';
import { resolveCookieSecure, readUserAgent } from '../utils';
import { defaultPasskeyName, normalizePasskeyName } from './passkeyNames';
import { PASSKEY_NAME_LENGTH } from './postgresWebAuthnCredentialStore';
import type { WebAuthnCredential } from './types';
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
	canRegister,
	challengeStore = createInMemoryWebAuthnChallengeStore(),
	challengeDurationMs = DEFAULT_WEBAUTHN_CHALLENGE_TTL_MS,
	cookieSecure,
	credentialStore,
	emit,
	getUserDisplayName,
	getUserId,
	getUserName,
	getWebAuthnUser,
	hasOtherSignInMethod,
	onWebAuthnAuthenticated,
	onWebAuthnRegistered,
	origin,
	rpId,
	rpName,
	sessionDurationMs = DEFAULT_WEBAUTHN_SESSION_TTL_MS,
	webauthnAdapter,
	webauthnRoute = DEFAULT_WEBAUTHN_ROUTE
}: WebAuthnRouteProps<UserType>) => {
	const secure = resolveCookieSecure(cookieSecure);
	const challengeCookie = t.Cookie({
		user_session_id: t.Optional(userSessionIdTypebox),
		webauthn_challenge: t.Optional(t.String())
	});
	const setChallenge = async (
		cookie: { set: (options: Record<string, unknown>) => void },
		challenge: string,
		purpose: 'registration' | 'authentication',
		sessionId?: string,
		userId?: string
	) => {
		const id = crypto.randomUUID();
		await challengeStore.save({
			challenge,
			expiresAt: Date.now() + challengeDurationMs,
			id,
			purpose,
			sessionId,
			userId
		});
		cookie.set({
			httpOnly: true,
			maxAge: Math.floor(challengeDurationMs / MILLISECONDS_IN_A_SECOND),
			sameSite: 'lax',
			secure,
			value: id
		});
	};

	const ownerOf = async (
		session: Parameters<
			typeof loadSessionFromSource<UserType>
		>[0]['session'],
		userSessionId: Parameters<
			typeof loadSessionFromSource<UserType>
		>[0]['userSessionId']
	) => {
		const current = await loadSessionFromSource({
			authSessionStore,
			session,
			userSessionId
		});

		return current
			? { user: current.user, userId: getUserId(current.user) }
			: undefined;
	};

	return (
		new Elysia()
			.use(sessionStore<UserType>())
			.post(
				`${webauthnRoute}/register/options`,
				{ cookie: challengeCookie },
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
						return status(
							'Unauthorized',
							'Authentication required'
						);
					}

					const { user } = userSession;
					if (canRegister && !(await canRegister(user)))
						return status('Forbidden', 'Account unavailable');
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
							userDisplayName:
								getUserDisplayName?.(user) ?? userId,
							userId,
							userName: getUserName?.(user) ?? userId
						});
					await setChallenge(
						webauthn_challenge,
						challenge,
						'registration',
						user_session_id.value,
						userId
					);

					return status('OK', options);
				}
			)
			.post(
				`${webauthnRoute}/register/verify`,
				{
					body: t.Object({}, { additionalProperties: true }),
					cookie: challengeCookie
				},
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
						return status(
							'Unauthorized',
							'Authentication required'
						);
					}

					if (canRegister && !(await canRegister(userSession.user)))
						return status('Forbidden', 'Account unavailable');
					const ceremony = await challengeStore.consume({
						id: webauthn_challenge.value ?? '',
						now: Date.now(),
						purpose: 'registration',
						sessionId: user_session_id.value,
						userId: getUserId(userSession.user)
					});
					webauthn_challenge.remove();
					const expectedChallenge = ceremony?.challenge;
					if (!isNonEmptyString(expectedChallenge)) {
						return status(
							'Bad Request',
							'No registration challenge in progress'
						);
					}

					// An optional `name` rides alongside the attestation; the adapter never sees it.
					const requestedName: unknown = Reflect.get(body, 'name');
					const attestation = Object.fromEntries(
						Object.entries(body).filter(([key]) => key !== 'name')
					);
					const result = await webauthnAdapter.verifyRegistration({
						expectedChallenge,
						expectedOrigin: origin,
						expectedRPID: rpId,
						response: attestation
					});
					webauthn_challenge.remove();
					if (!result.verified || !result.credential) {
						return status(
							'Bad Request',
							'WebAuthn registration failed'
						);
					}

					const userId = getUserId(userSession.user);
					const { aaguid, ...registered } = result.credential;
					await credentialStore.saveCredential({
						...registered,
						createdAt: Date.now(),
						name:
							normalizePasskeyName(
								requestedName,
								PASSKEY_NAME_LENGTH
							) ??
							defaultPasskeyName({
								aaguid,
								backedUp: registered.backedUp
							}),
						userId
					});
					await emit?.({
						at: Date.now(),
						metadata: {
							credentialId: result.credential.credentialId
						},
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
				}
			)
			.post(
				`${webauthnRoute}/authenticate/options`,
				{ cookie: challengeCookie },
				async ({
					cookie: { user_session_id, webauthn_challenge },
					status
				}) => {
					const { challenge, options } =
						await webauthnAdapter.createAuthenticationOptions({
							allowCredentials: [],
							rpId
						});
					await setChallenge(
						webauthn_challenge,
						challenge,
						'authentication',
						user_session_id.value
					);

					return status('OK', options);
				}
			)
			.post(
				`${webauthnRoute}/authenticate/verify`,
				{
					body: t.Object(
						{ id: t.String() },
						{ additionalProperties: true }
					),
					cookie: challengeCookie
				},
				async ({
					request,
					body,
					cookie: { user_session_id, webauthn_challenge },
					status,
					store: { session }
				}) => {
					const ceremony = await challengeStore.consume({
						id: webauthn_challenge.value ?? '',
						now: Date.now(),
						purpose: 'authentication',
						sessionId: user_session_id.value
					});
					webauthn_challenge.remove();
					const expectedChallenge = ceremony?.challenge;
					if (!isNonEmptyString(expectedChallenge)) {
						return status(
							'Bad Request',
							'No authentication challenge in progress'
						);
					}

					const credential = await credentialStore.getCredential(
						body.id
					);
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
						cookieSecure,
						inMemorySession: session,
						sessionDurationMs,
						signInMethod: 'passkey',
						user,
						userAgent: readUserAgent(request)
					});
					await emit?.({
						at: Date.now(),
						type: 'webauthn_authenticated',
						userId: credential.userId
					});
					await onWebAuthnAuthenticated?.({ user, userSessionId });

					return status('OK', { status: 'authenticated' });
				}
			)
			// Passkey management for the signed-in user: list, rename, remove.
			.get(
				`${webauthnRoute}/credentials`,
				{ cookie: challengeCookie },
				async ({
					cookie: { user_session_id },
					status,
					store: { session }
				}) => {
					const owner = await ownerOf(session, user_session_id.value);
					if (!owner)
						return status(
							'Unauthorized',
							'Authentication required'
						);
					const credentials =
						await credentialStore.listCredentialsByUser(
							owner.userId
						);

					return status('OK', {
						credentials: credentials
							.sort(
								(first, second) =>
									second.createdAt - first.createdAt
							)
							.map(summarizeCredential)
					});
				}
			)
			.patch(
				`${webauthnRoute}/credentials/:id`,
				{
					body: t.Object({ name: t.String({ maxLength: 200 }) }),
					cookie: challengeCookie,
					params: t.Object({ id: t.String({ maxLength: 1024 }) })
				},
				async ({
					body,
					cookie: { user_session_id },
					params: { id },
					status,
					store: { session }
				}) => {
					const owner = await ownerOf(session, user_session_id.value);
					if (!owner)
						return status(
							'Unauthorized',
							'Authentication required'
						);
					if (!credentialStore.renameCredential)
						return status(
							'Not Implemented',
							'This credential store cannot rename passkeys'
						);
					const credential = await credentialStore.getCredential(id);
					if (!credential || credential.userId !== owner.userId)
						return status('Not Found', 'Passkey not found');
					const name = normalizePasskeyName(
						body.name,
						PASSKEY_NAME_LENGTH
					);
					if (!name) return status('Bad Request', 'Name the passkey');
					await credentialStore.renameCredential(id, name);
					await emit?.({
						at: Date.now(),
						metadata: { credentialId: id },
						type: 'webauthn_renamed',
						userId: owner.userId
					});

					return status('OK', {
						...summarizeCredential(credential),
						name
					});
				}
			)
			.delete(
				`${webauthnRoute}/credentials/:id`,
				{
					cookie: challengeCookie,
					params: t.Object({ id: t.String({ maxLength: 1024 }) })
				},
				async ({
					cookie: { user_session_id },
					params: { id },
					status,
					store: { session }
				}) => {
					const owner = await ownerOf(session, user_session_id.value);
					if (!owner)
						return status(
							'Unauthorized',
							'Authentication required'
						);
					const credential = await credentialStore.getCredential(id);
					// Someone else's passkey looks the same as a missing one.
					if (!credential || credential.userId !== owner.userId)
						return status('Not Found', 'Passkey not found');
					if (hasOtherSignInMethod) {
						const others = (
							await credentialStore.listCredentialsByUser(
								owner.userId
							)
						).filter((other) => other.credentialId !== id);
						if (
							others.length === 0 &&
							!(await hasOtherSignInMethod({
								credential,
								user: owner.user
							}))
						)
							return status(
								'Conflict',
								'Keep at least one way to sign in'
							);
					}
					await credentialStore.removeCredential(id);
					await emit?.({
						at: Date.now(),
						metadata: { credentialId: id },
						type: 'webauthn_removed',
						userId: owner.userId
					});

					return status('OK', { removed: id });
				}
			)
	);
};

const summarizeCredential = (credential: WebAuthnCredential) => ({
	backedUp: credential.backedUp ?? false,
	createdAt: credential.createdAt,
	deviceType: credential.deviceType,
	id: credential.credentialId,
	lastUsedAt: credential.lastUsedAt,
	name: credential.name,
	transports: credential.transports
});

export type PasskeySummary = ReturnType<typeof summarizeCredential>;
