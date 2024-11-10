import Elysia from 'elysia';
import { ClientProviders, OAuthEventHandler } from './types';
import { isValidProviderKey } from './typeGuards';

type RevokeProps = {
	clientProviders: ClientProviders;
	revokeRoute?: string;
	onRevoke?: OAuthEventHandler;
};

export const revoke = ({
	clientProviders,
	revokeRoute = 'revoke',
	onRevoke
}: RevokeProps) => {
	return new Elysia().post(
		`/${revokeRoute}/access-token`,
		async ({ error, cookie: { user_refresh_token, auth_provider } }) => {
			if (user_refresh_token.value === undefined) {
				return error(401, 'No refresh token found');
			}

			if (auth_provider.value === undefined) {
				return error(401, 'No auth provider found');
			}

			if (!isValidProviderKey(auth_provider.value)) {
				return error(400, 'Invalid provider');
			}

			const normalizedProvider = auth_provider.value.toLowerCase();
			const { providerInstance } = clientProviders[normalizedProvider];

			// TODO - Implement the revoke function

			onRevoke?.();
		}
	);
};
