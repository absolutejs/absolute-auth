import { Elysia } from 'elysia';
import { isRefreshableProvider } from './typeGuards';
import { ClientProviders } from './types';

type RefreshProps = {
	clientProviders: ClientProviders;
	refreshRoute?: string;
	onRefresh?: () => void;
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

			const normalizedProvider = auth_provider.value.toLowerCase();
			const { providerInstance } = clientProviders[normalizedProvider];

			if (!isRefreshableProvider(providerInstance)) {
				return error('Not Implemented', 'Provider is not refreshable');
			}

			try {
				//consider passing tokens to onRefresh
				// const tokens = await providerInstance.refreshAccessToken(
				// 	user_refresh_token.value
				// );

				await providerInstance.refreshAccessToken(
					user_refresh_token.value
				);

				onRefresh?.();

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
