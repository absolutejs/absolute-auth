import { createOAuth2Client, isValidProviderOption } from 'citra';
import { Elysia } from 'elysia';
import { authorize } from './authorize';
import { callback } from './callback';
import { profile } from './profile';
import { protectRoute } from './protectRoute';
import { refresh } from './refresh';
import { revoke } from './revoke';
import { signout } from './signout';
import { status } from './status';
import { AbsoluteAuthProps, ClientProviders } from './types';

export const absoluteAuth = <UserType>({
	providersConfiguration,
	authorizeRoute,
	callbackRoute,
	profileRoute,
	signoutRoute,
	statusRoute,
	refreshRoute,
	revokeRoute,
	onAuthorize,
	onProfile,
	onCallback,
	onStatus,
	onRefresh,
	onSignOut,
	onRevocation
}: AbsoluteAuthProps<UserType>) => {
	const clientProviders = Object.entries(
		providersConfiguration
	).reduce<ClientProviders>((acc, [providerName, providerConfig]) => {
		if (isValidProviderOption(providerName)) {
			acc[providerName] = {
				providerInstance: createOAuth2Client(
					providerName,
					providerConfig.credentials
				),
				scope: providerConfig.scope,
				searchParams: providerConfig.searchParams
			};
		}

		return acc;
	}, {});

	return new Elysia()
		.use(signout({ onSignOut, signoutRoute }))
		.use(revoke({ clientProviders, onRevocation, revokeRoute }))
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
		.use(
			profile({
				clientProviders,
				onProfile,
				profileRoute
			})
		)
		.use(protectRoute())
		.as('plugin');
};

export * from './utils';
