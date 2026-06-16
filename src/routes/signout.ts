import { Elysia, t } from 'elysia';
import { createSessionCompatibilityLayer } from '../session/access';
import { sessionStore } from '../session/state';
import type { AuthSessionStore } from '../session/types';
import { withSpan } from '../telemetry/tracing';
import { authProviderOption } from '../typebox';
import { OnSignOut, RouteString } from '../types';

type SignOutProps<UserType> = {
	authSessionStore?: AuthSessionStore<UserType>;
	signoutRoute?: RouteString;
	onSignOut: OnSignOut<UserType>;
};

const runSignOut = async <UserType>(
	onSignOut: OnSignOut<UserType>,
	args: Parameters<NonNullable<OnSignOut<UserType>>>[0]
) => {
	try {
		await onSignOut?.(args);

		return true;
	} catch (err) {
		console.error('[signout] Sign out operation failed:', {
			authProvider: args.authProvider,
			error: err instanceof Error ? err.message : err,
			stack: err instanceof Error ? err.stack : undefined
		});

		return false;
	}
};

export const signout = <UserType>({
	authSessionStore,
	signoutRoute = '/oauth2/signout',
	onSignOut
}: SignOutProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).delete(
		signoutRoute,
		async ({
			status,
			store: { session },
			cookie: { user_session_id, auth_provider }
		}) =>
			withSpan(
				'auth.signout',
				{ 'auth.provider': auth_provider?.value },
				async () => {
					if (user_session_id === undefined) {
						return status('Bad Request', 'Cookies are missing');
					}
					if (user_session_id.value === undefined) {
						return status(
							'Unauthorized',
							'No user session id found'
						);
					}
					// `auth_provider` is only set by the OAuth2 `/authorize` flow. Credentials,
					// MFA, passwordless, SSO, WebAuthn, and impersonation-minted sessions never
					// set it — but they are still valid sessions and must be signable-out.
					// Prior versions hard-failed here, which 401'd every non-OAuth signout
					// (issue #7).

					const compatibilityLayer =
						await createSessionCompatibilityLayer({
							authSessionStore,
							userSessionId: user_session_id.value
						});
					const signoutSession = authSessionStore
						? compatibilityLayer.session
						: session;
					const currentSession =
						signoutSession[user_session_id.value];

					if (currentSession !== undefined) {
						const signedOut = await runSignOut(onSignOut, {
							authProvider: auth_provider?.value,
							session: signoutSession,
							userSessionId: user_session_id.value
						});
						if (!signedOut) {
							return status(
								'Internal Server Error',
								'Sign out operation failed'
							);
						}
					}

					delete signoutSession[user_session_id.value];
					if (authSessionStore) {
						await compatibilityLayer.persist();
						await authSessionStore.removeSession(
							user_session_id.value
						);
						await authSessionStore.removeUnregisteredSession(
							user_session_id.value
						);
					} else {
						delete session[user_session_id.value];
					}

					user_session_id.remove();
					auth_provider?.remove();

					return new Response(null, { status: 204 });
				}
			),
		{
			cookie: t.Cookie({
				auth_provider: t.Optional(authProviderOption),
				user_session_id: t.Optional(
					t.TemplateLiteral(
						'${string}-${string}-${string}-${string}-${string}'
					)
				)
			})
		}
	);
