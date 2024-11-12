import Elysia from 'elysia';
import type { ClientProviders, OAuthEventHandler } from './types';
import { isRefreshableProvider } from './typeGuards';

type RefreshProps = {
	clientProviders: ClientProviders;
	refreshRoute?: string;
	onRefresh?: OAuthEventHandler;
};

export const refresh = ({
	clientProviders,
	refreshRoute = 'refresh',
	onRefresh
}: RefreshProps) => {
	return new Elysia().post(
		`/${refreshRoute}`,
		async ({ error, cookie: { user_refresh_token, auth_provider } }) => {
			if (user_refresh_token.value === undefined) {
				return error(401, 'No refresh token found');
			}

			if (auth_provider.value === undefined) {
				return error(401, 'No auth provider found');
			}

			const normalizedProvider = auth_provider.value.toLowerCase();
			const { providerInstance } = clientProviders[normalizedProvider];

			if (!isRefreshableProvider(providerInstance)) {
				return error(401, 'Provider is not refreshable');
			}

			try {
				//consider passing tokens to onRefresh
				const tokens = await providerInstance.refreshAccessToken(
					user_refresh_token.value
				);

				onRefresh?.();

				return new Response('Token refreshed', {
					status: 204
				});
			} catch (err) {
				if (err instanceof Error) {
					console.error('Failed to refresh token:', err.message);
				}

				return error(500);
			}
		}
	);
};
