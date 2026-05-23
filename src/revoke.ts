import { isRevocableOAuth2Client, isValidProviderOption } from 'citra';
import { Elysia, t } from 'elysia';
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
	OnRevocationError,
	OnRevocationSuccess,
	RouteString
} from './types';

type RevokeProps<UserType> = {
	authSessionStore?: AbsoluteAuthSessionStore<UserType>;
	clientProviders: ClientProviders;
	revokeRoute?: RouteString;
	onRevocationSuccess: OnRevocationSuccess;
	onRevocationError: OnRevocationError;
};

export const revoke = <UserType>({
	authSessionStore,
	clientProviders,
	revokeRoute = '/oauth2/revocation',
	onRevocationSuccess,
	onRevocationError
}: RevokeProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).post(
		revokeRoute,
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

			if (
				!isRevocableOAuth2Client(auth_provider.value, providerInstance)
			) {
				return status(
					'Not Implemented',
					'Provider does not support revocation'
				);
			}

			const userSession = await loadSessionFromSource({
				authSessionStore,
				session,
				userSessionId: user_session_id.value
			});

			if (userSession === undefined) {
				return status('Unauthorized', 'No user session found');
			}

			const { accessToken } = userSession;

			try {
				await providerInstance.revokeToken(accessToken);

				await onRevocationSuccess?.({
					authClient: clientName,
					authProvider: auth_provider.value,
					tokenToRevoke: accessToken
				});

				return new Response('Token revoked', {
					status: 204
				});
			} catch (err) {
				console.error('[revoke] Failed to revoke token:', {
					authClient: clientName,
					authProvider: auth_provider.value,
					error: err instanceof Error ? err.message : err,
					stack: err instanceof Error ? err.stack : undefined
				});

				await onRevocationError?.({
					authClient: clientName,
					authProvider: auth_provider.value,
					error: err
				});

				return status(
					'Internal Server Error',
					'Failed to revoke token'
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
