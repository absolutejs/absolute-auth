import { isRefreshableOAuth2Client, isValidProviderOption } from 'citra';
import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import { ClientProviders, OnRefresh, RouteString } from './types';

type RefreshProps = {
	clientProviders: ClientProviders;
	refreshRoute?: RouteString;
	onRefresh?: OnRefresh;
};

export const refresh = <UserType>({
	clientProviders,
	refreshRoute = '/oauth2/tokens',
	onRefresh
}: RefreshProps) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.post(
			refreshRoute,
			async ({
				error,
				store: { session },
				cookie: { user_session_id, auth_provider }
			}) => {
				if (
					auth_provider === undefined ||
					user_session_id === undefined
				)
					return error('Bad Request', 'Cookies are missing');

				if (auth_provider.value === undefined) {
					return error('Unauthorized', 'No auth provider found');
				}

				if (!isValidProviderOption(auth_provider.value)) {
					return error('Bad Request', 'Invalid provider');
				}

				if (user_session_id.value === undefined) {
					return error('Unauthorized', 'No user session found');
				}

				const providerConfig = clientProviders[auth_provider.value];
				if (!providerConfig) {
					return error('Unauthorized', 'Client provider not found');
				}
				const { providerInstance } = providerConfig;

				const userSession = session[user_session_id.value];

				if (userSession === undefined) {
					return error('Unauthorized', 'No user session found');
				}

				const { refreshToken } = userSession;

				if (
					!isRefreshableOAuth2Client(
						auth_provider.value,
						providerInstance
					)
				) {
					return error(
						'Not Implemented',
						'Provider is not refreshable'
					);
				}

				if (refreshToken === undefined) {
					return error('Bad Request', 'No refresh token found');
				}

				try {
					const tokenResponse =
						await providerInstance.refreshAccessToken(refreshToken);

					onRefresh?.({
						authProvider: auth_provider.value,
						tokenResponse
					});

					return new Response('Token refreshed', {
						status: 204
					});
				} catch (err) {
					if (err instanceof Error) {
						return error(
							'Internal Server Error',
							`Failed to refresh token: ${err.message}`
						);
					}

					return error(
						'Internal Server Error',
						`Failed to refresh token: Unknown error: ${err}`
					);
				}
			}
		);
