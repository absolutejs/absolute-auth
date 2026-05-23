import { isRefreshableOAuth2Client, isValidProviderOption } from 'citra';
import { Elysia, t } from 'elysia';
import { MILLISECONDS_IN_A_DAY } from './constants';
import { resolveClientProviderEntry } from './providerClients';
import { loadSessionFromSource } from './sessionAccess';
import { sessionStore } from './sessionStore';
import type { AbsoluteAuthSessionStore } from './sessionTypes';
import {
	authClientOption,
	authProviderOption,
	userSessionIdTypebox
} from './typebox';
import {
	ClientProviders,
	OnRefreshError,
	OnRefreshSuccess,
	RouteString
} from './types';

type RefreshProps<UserType> = {
	authSessionStore?: AbsoluteAuthSessionStore<UserType>;
	clientProviders: ClientProviders;
	refreshRoute?: RouteString;
	onRefreshSuccess: OnRefreshSuccess;
	onRefreshError: OnRefreshError;
	sessionDurationMs?: number;
};

export const refresh = <UserType>({
	authSessionStore,
	clientProviders,
	refreshRoute = '/oauth2/tokens',
	onRefreshSuccess,
	onRefreshError,
	sessionDurationMs = MILLISECONDS_IN_A_DAY
}: RefreshProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).post(
		refreshRoute,
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

			if (!isValidProviderOption(auth_provider.value)) {
				return status('Bad Request', 'Invalid provider');
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

			const userSession = await loadSessionFromSource({
				authSessionStore,
				session,
				userSessionId: user_session_id.value
			});

			if (userSession === undefined) {
				return status('Unauthorized', 'No user session found');
			}

			const { refreshToken } = userSession;

			if (
				!isRefreshableOAuth2Client(
					auth_provider.value,
					providerInstance
				)
			) {
				return status('Not Implemented', 'Provider is not refreshable');
			}

			if (refreshToken === undefined) {
				return status('Bad Request', 'No refresh token found');
			}

			try {
				const tokenResponse =
					await providerInstance.refreshAccessToken(refreshToken);

				userSession.accessToken = tokenResponse.access_token;
				userSession.expiresAt = Date.now() + sessionDurationMs;
				userSession.refreshToken =
					tokenResponse.refresh_token ?? userSession.refreshToken;

				if (authSessionStore) {
					await authSessionStore.setSession(
						user_session_id.value,
						userSession
					);
				}

				await onRefreshSuccess?.({
					authClient: clientName,
					authProvider: auth_provider.value,
					tokenResponse
				});

				return new Response('Token refreshed', {
					status: 204
				});
			} catch (err) {
				console.error('[refresh] Failed to refresh token:', {
					authClient: clientName,
					authProvider: auth_provider.value,
					error: err instanceof Error ? err.message : err,
					stack: err instanceof Error ? err.stack : undefined
				});

				await onRefreshError?.({
					authClient: clientName,
					authProvider: auth_provider.value,
					error: err
				});

				return status(
					'Internal Server Error',
					'Failed to refresh token'
				);
			}
		},
		{
			cookie: t.Cookie({
				auth_client: authClientOption,
				auth_provider: authProviderOption,
				user_session_id: userSessionIdTypebox
			})
		}
	);
