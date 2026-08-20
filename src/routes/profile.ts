import { isProfileOAuth2Client } from 'citra';
import { Elysia, t } from 'elysia';
import { resolveClientProviderEntry } from '../providers/clients';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import type { AuthSessionStore } from '../session/types';
import {
	authClientOption,
	authProviderOption,
	userSessionIdTypebox
} from '../typebox';
import {
	ClientProviders,
	OnProfileError,
	OnProfileSuccess,
	RouteString
} from '../types';

type ProfileProps<UserType> = {
	authSessionStore?: AuthSessionStore<UserType>;
	clientProviders: ClientProviders;
	profileRoute?: RouteString;
	onProfileSuccess: OnProfileSuccess;
	onProfileError: OnProfileError;
};

export const profile = <UserType>({
	authSessionStore,
	clientProviders,
	profileRoute = '/oauth2/profile',
	onProfileSuccess,
	onProfileError
}: ProfileProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).get(
		profileRoute,
		{
			cookie: t.Cookie({
				auth_client: authClientOption,
				auth_provider: authProviderOption,
				user_session_id: userSessionIdTypebox
			})
		},
		async ({
			status,
			store: { session },
			cookie: { user_session_id, auth_provider, auth_client }
		}) => {
			if (
				auth_provider === undefined ||
				auth_client === undefined ||
				user_session_id === undefined
			)
				return status('Bad Request', 'Cookies are missing');

			if (auth_provider.value === undefined) {
				return status('Unauthorized', 'No auth provider found');
			}

			if (user_session_id.value === undefined) {
				return status('Unauthorized', 'No user session found');
			}

			const resolvedProvider = resolveClientProviderEntry({
				clientName: auth_client.value || undefined,
				clientProviders,
				providerName: auth_provider.value
			});
			if ('error' in resolvedProvider) {
				return status('Unauthorized', resolvedProvider.error);
			}
			const { clientName, providerInstance } = resolvedProvider.entry;
			if (!isProfileOAuth2Client(providerInstance)) {
				return status(
					'Not Implemented',
					'Provider does not expose a profile endpoint'
				);
			}

			const userSession = await loadSessionFromSource({
				authSessionStore,
				session,
				userSessionId: user_session_id.value
			});

			if (userSession === undefined) {
				return status('Unauthorized', 'No user session found');
			}

			const { accessToken } = userSession;

			if (accessToken === undefined) {
				return status(
					'Bad Request',
					'Session has no access token to fetch a profile'
				);
			}

			try {
				const userProfile =
					await providerInstance.fetchUserProfile(accessToken);

				await onProfileSuccess?.({
					authClient: clientName,
					authProvider: auth_provider.value,
					userProfile
				});

				return new Response(JSON.stringify(userProfile));
			} catch (err) {
				await onProfileError?.({
					authClient: clientName,
					authProvider: auth_provider.value,
					error: err
				});

				return err instanceof Error
					? status(
							'Internal Server Error',
							`${err.message} - ${err.stack ?? ''}`
						)
					: status(
							'Internal Server Error',
							`Failed to validate authorization code: Unknown status: ${err}`
						);
			}
		}
	);
