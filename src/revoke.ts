import { isRevocableOAuth2Client, isValidProviderOption } from 'citra';
import { Elysia } from 'elysia';
import { ClientProviders } from './types';

type RevokeProps = {
	clientProviders: ClientProviders;
	revokeRoute?: string;
	onRevoke?: () => void;
};

export const revoke = ({
	clientProviders,
	revokeRoute = 'revoke',
	onRevoke
}: RevokeProps) =>
	new Elysia().post(
		`/${revokeRoute}/access-token`,
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
				!isRevocableOAuth2Client(auth_provider.value, providerInstance)
			) {
				return error(
					'Not Implemented',
					'Provider does not support revocation'
				);
			}

			try {
				await providerInstance.revokeToken(user_refresh_token.value);

				onRevoke?.();

				return new Response('Token revoked', {
					status: 204
				});
			} catch (err) {
				if (err instanceof Error) {
					return error(
						'Internal Server Error',
						`Failed to revoke token: ${err.message}`
					);
				}

				return error(
					'Internal Server Error',
					`Failed to revoke token: Unknown error: ${err}`
				);
			}
		}
	);
