import { Elysia } from 'elysia';
import { authorize } from './authorize';
import { callback } from './callback';
import { logout } from './logout';
import { protectRoute } from './protectRoute';
import { refresh } from './refresh';
import { revoke } from './revoke';
import { status } from './status';
import { AbsoluteAuthProps, ClientProviders } from './types';
import { isValidProviderOption, createOAuth2Client } from 'citra';

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
	const clientProviders = Object.entries(config).reduce<ClientProviders>(
		(acc, [providerName, providerConfig]) => {
			if (isValidProviderOption(providerName)) {
				acc[providerName] = {
					providerInstance: createOAuth2Client(
						providerName,
						providerConfig.credentials
					),
					scopes: providerConfig.scopes,
					searchParams: providerConfig.searchParams
				};
			}
			return acc;
		},
		{}
	);

	return new Elysia()
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

export * from './utils';
