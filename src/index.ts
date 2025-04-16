import { OAuth2RequestError, ArcticFetchError } from 'arctic';
import { Elysia } from 'elysia';
import { authorize } from './authorize';
import { callback } from './callback';
import { logout } from './logout';
import { protectRoute } from './protectRoute';
import { normalizedProviderKeys, providers } from './providers';
import { refresh } from './refresh';
import { revoke } from './revoke';
import { status } from './status';
import { isValidProviderKey } from './typeGuards';
import { AbsoluteAuthProps, ClientProviders } from './types';

export const absoluteAuth = <UserType>({
	config,
	authorizeRoute,
	callbackRoute,
	logoutRoute,
	statusRoute,
	refreshRoute,
	revokeRoute,
	onAuthorize,
	onCallback,
	onStatus,
	onRefresh,
	onLogout,
	onRevoke
}: AbsoluteAuthProps<UserType>) => {
	const clientProviders = Object.keys(config).reduce<ClientProviders>(
		(acc, key) => {
			if (!Object.prototype.hasOwnProperty.call(config, key)) return acc;

			if (!isValidProviderKey(key)) {
				console.error(`Provider ${key} is not supported`);

				return acc;
			}

			const options = config[key];
			if (!options) return acc;

			const normalizedProvider = key.toLowerCase();
			const originalProviderKey =
				normalizedProviderKeys[normalizedProvider];

			if (!isValidProviderKey(originalProviderKey)) {
				console.error(`Provider ${key} is not supported`);

				return acc;
			}

			const Provider = providers[originalProviderKey];
			const { credentials, scopes = [], searchParams = [] } = options;

			// @ts-expect-error: dynamic constructor parameters
			const providerInstance = new Provider(...credentials);

			acc[normalizedProvider] = {
				providerInstance,
				scopes,
				searchParams
			};

			return acc;
		},
		{}
	);

	return new Elysia()
		.error('OAUTH2_REQUEST_ERROR', OAuth2RequestError)
		.error('ARCTIC_FETCH_ERROR', ArcticFetchError)
		.use(logout({ logoutRoute, onLogout }))
		.use(revoke({ clientProviders, onRevoke, revokeRoute }))
		.use(status<UserType>({ clientProviders, onStatus, statusRoute }))
		.use(refresh({ clientProviders, onRefresh, refreshRoute }))
		.use(authorize({ authorizeRoute, clientProviders, onAuthorize }))
		.use(
			callback<UserType>({
				callbackRoute,
				clientProviders,
				onCallback
			})
		)
		.use(protectRoute())
		.as('plugin');
};
