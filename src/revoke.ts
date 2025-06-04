import { isRevocableOAuth2Client, isValidProviderOption } from 'citra';
import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import {
	ClientProviders,
	OnAuthorizeError,
	OnRevocationSuccess,
	RouteString
} from './types';

type RevokeProps = {
	clientProviders: ClientProviders;
	revokeRoute?: RouteString;
	onRevocationSuccess?: OnRevocationSuccess;
	onRevocationError?: OnAuthorizeError;
};

export const revoke = <UserType>({
	clientProviders,
	revokeRoute = '/oauth2/revocation',
	onRevocationSuccess,
	onRevocationError
}: RevokeProps) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.post(
			revokeRoute,
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

				if (
					!isRevocableOAuth2Client(
						auth_provider.value,
						providerInstance
					)
				) {
					return error(
						'Not Implemented',
						'Provider does not support revocation'
					);
				}

				const userSession = session[user_session_id.value];

				if (userSession === undefined) {
					return error('Unauthorized', 'No user session found');
				}

				const { accessToken } = userSession; // TODO: Some providers use refresh tokenResponse for revocation

				try {
					await providerInstance.revokeToken(accessToken);

					await onRevocationSuccess?.({
						authProvider: auth_provider.value,
						tokenToRevoke: accessToken
					});

					return new Response('Token revoked', {
						status: 204
					});
				} catch (err) {
					await onRevocationError?.({
						authProvider: auth_provider.value,
						error: err
					});

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
