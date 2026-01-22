import { isRevocableOAuth2Client, isValidProviderOption } from 'citra';
import { Elysia, t } from 'elysia';
import { sessionStore } from './sessionStore';
import { userSessionIdTypebox } from './typebox';
import {
	ClientProviders,
	OnRevocationError,
	OnRevocationSuccess,
	RouteString
} from './types';

type RevokeProps = {
	clientProviders: ClientProviders;
	revokeRoute?: RouteString;
	onRevocationSuccess: OnRevocationSuccess;
	onRevocationError: OnRevocationError;
};

export const revoke = <UserType>({
	clientProviders,
	revokeRoute = '/oauth2/revocation',
	onRevocationSuccess,
	onRevocationError
}: RevokeProps) =>
	new Elysia().use(sessionStore<UserType>()).post(
		revokeRoute,
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

			if (
				!isRevocableOAuth2Client(auth_provider.value, providerInstance)
			) {
				return status(
					'Not Implemented',
					'Provider does not support revocation'
				);
			}

			const userSession = session[user_session_id.value];

			if (userSession === undefined) {
				return status('Unauthorized', 'No user session found');
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
				console.error('[revoke] Failed to revoke token:', {
					authProvider: auth_provider.value,
					error: err instanceof Error ? err.message : err,
					stack: err instanceof Error ? err.stack : undefined
				});

				await onRevocationError?.({
					authProvider: auth_provider.value,
					error: err
				});

				return status(
					'Internal Server Error',
					'Failed to revoke token'
				);
			}
		},
		{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) }
	);
