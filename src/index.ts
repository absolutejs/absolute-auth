import Elysia from 'elysia';
import {
	normalizedProviderKeys,
	normalizedUserInfoURLKeys,
	providers,
	userInfoURLs
} from './providers';
import { OAuth2RequestError, ArcticFetchError } from 'arctic';
import type { AbsoluteAuthProps, ClientProviders } from './types';
import { logout } from './logout';
import { revoke } from './revoke';
import { status } from './status';
import { refresh } from './refresh';
import { authorize } from './authorize';
import { callback } from './callback';
import { protectRoute } from './protectRoute';
import { isValidUserInfoURLKey, isValidProviderKey } from './typeGuards';

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
	onRevoke,
	createUser,
	getUser
}: AbsoluteAuthProps) => {
	const clientProviders = Object.entries(config).reduce(
		(acc, [provider, options = {}]) => {
			const normalizedProvider = provider.toLowerCase();

			const originalProviderKey =
				normalizedProviderKeys[normalizedProvider];
			const userInfoURLKey =
				normalizedUserInfoURLKeys[normalizedProvider];

			if (
				!originalProviderKey ||
				!isValidProviderKey(originalProviderKey)
			) {
				console.error(`Provider ${provider} is not supported`);
				return acc;
			}

			const Provider = providers[originalProviderKey];

			let userInfoURL: string | undefined;

			if (isValidUserInfoURLKey(userInfoURLKey)) {
				userInfoURL = userInfoURLs[userInfoURLKey];
			}

			const {
				credentials = [],
				scopes = [],
				searchParams = []
			} = options as {
				credentials: ConstructorParameters<typeof Provider>;
				scopes?: string[];
				searchParams?: [string, string][];
			};

			// @ts-expect-error - The constructor parameters are dynamic
			// and idk the fix for this
			const providerInstance = new Provider(...credentials);

			acc[normalizedProvider] = {
				providerInstance,
				scopes,
				searchParams,
				userInfoURL
			};

			return acc;
		},
		{} as ClientProviders
	);

	// TODO: Remove the any call by adding UserType correctly
	return new Elysia()
		.error('OAUTH2_REQUEST_ERROR', OAuth2RequestError)
		.error('ARCTIC_FETCH_ERROR', ArcticFetchError)
		.use(logout({ logoutRoute, onLogout }))
		.use(revoke({ clientProviders, revokeRoute, onRevoke }))
		.use(status<UserType>({ statusRoute, onStatus }))
		.use(refresh({ clientProviders, refreshRoute, onRefresh }))
		.use(authorize({ clientProviders, authorizeRoute, onAuthorize }))
		.use(
			callback<UserType>({
				clientProviders,
				callbackRoute,
				onCallback,
				getUser,
				createUser
			})
		)
		.use(protectRoute<UserType>())
		.as('plugin');
};
