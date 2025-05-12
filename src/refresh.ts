import { isRefreshableOAuth2Client, isValidProviderOption } from 'citra';
import { Elysia } from 'elysia';
import { ClientProviders, OnRefresh } from './types';

type RefreshProps = {
	clientProviders: ClientProviders;
	refreshRoute?: string;
	onRefresh?: OnRefresh;
};

export const refresh = ({
	clientProviders,
	refreshRoute = 'refresh',
	onRefresh
}: RefreshProps) =>
	new Elysia().post(
		`/${refreshRoute}`,
		async ({ error, cookie: { user_refresh_token, auth_provider } }) => {
			if (user_refresh_token.value === undefined) {
				return error('Unauthorized', 'No refresh token found');
			}

			if (auth_provider.value === undefined) {
				return error('Unauthorized', 'No auth provider found');
			}

			if (!isValidProviderOption(auth_provider.value)) {
				return error('Bad Request', 'Invalid provider');
			}

			const { providerInstance } = clientProviders[auth_provider.value];

			if (
				!isRefreshableOAuth2Client(
					auth_provider.value,
					providerInstance
				)
			) {
				return error('Not Implemented', 'Provider is not refreshable');
			}

			try {
				const tokens = await providerInstance.refreshAccessToken(
					user_refresh_token.value
				);

				onRefresh?.({ tokens });

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
					`Faile to refresh token: Unknown error: ${err}`
				);
			}
		}
	);
