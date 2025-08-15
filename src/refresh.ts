import { isRefreshableOAuth2Client, isValidProviderOption } from 'citra';
import { Elysia, t } from 'elysia';
import { sessionStore } from './sessionStore';
import { userSessionIdCookie } from './typebox';
import {
	ClientProviders,
	OnRefreshError,
	OnRefreshSuccess,
	RouteString
} from './types';

type RefreshProps = {
	clientProviders: ClientProviders;
	refreshRoute?: RouteString;
	onRefreshSuccess: OnRefreshSuccess;
	onRefreshError: OnRefreshError;
};

export const refresh = <UserType>({
	clientProviders,
	refreshRoute = '/oauth2/tokens',
	onRefreshSuccess,
	onRefreshError
}: RefreshProps) =>
	new Elysia().use(sessionStore<UserType>()).post(
		refreshRoute,
		async ({
			status,
			store: { session },
			cookie: { user_session_id, auth_provider }
		}) => {
			if (auth_provider === undefined || user_session_id === undefined)
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

			const providerConfig = clientProviders[auth_provider.value];
			if (!providerConfig) {
				return status('Unauthorized', 'Client provider not found');
			}
			const { providerInstance } = providerConfig;

			const userSession = session[user_session_id.value];

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

				await onRefreshSuccess?.({
					authProvider: auth_provider.value,
					tokenResponse
				});

				return new Response('Token refreshed', {
					status: 204
				});
			} catch (err) {
				await onRefreshError?.({
					authProvider: auth_provider.value,
					error: err
				});

				if (err instanceof Error) {
					return status(
						'Internal Server Error',
						`Failed to refresh token: ${err.message}`
					);
				}

				return status(
					'Internal Server Error',
					`Failed to refresh token: Unknown status: ${err}`
				);
			}
		},
		{ cookie: t.Cookie({ user_session_id: userSessionIdCookie }) }
	);
