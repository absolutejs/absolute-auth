import { isValidProviderOption, createOAuth2Client } from 'citra';
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

export const absoluteAuth = async <UserType>({
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
	const entryPromises: Array<Promise<[string, ClientProviders[string]]>> = [];

	for (const [providerName, providerConfig] of Object.entries(
		providersConfiguration
	)) {
		if (!isValidProviderOption(providerName)) continue;

		entryPromises.push(
			createOAuth2Client(providerName, providerConfig.credentials).then(
				(providerInstance) => [
					providerName,
					{
						providerInstance,
						scope: providerConfig.scope,
						searchParams: providerConfig.searchParams
					}
				]
			)
		);
	}

	const clientProviders: ClientProviders = Object.fromEntries(
		await Promise.all(entryPromises)
	);

	return new Elysia()
		.use(signout({ onSignOut, signoutRoute }))
		.use(revoke({ clientProviders, onRevocation, revokeRoute }))
		.use(status<UserType>({ onStatus, statusRoute }))
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

export * from './types';
export { isValidUser } from './typeGuards';
export * from './utils';
export type {
	OAuth2TokenResponse,
	OAuth2Client,
	ProviderOption,
	PKCEProvider,
	OIDCProvider,
	RefreshableProvider,
	RevocableProvider,
	ScopeRequiredProvider,
	CredentialsFor
} from 'citra';

export {
	providerOptions,
	refreshableProviderOptions,
	revocableProviderOptions,
	oidcProviderOptions,
	pkceProviderOptions,
	scopeRequiredProviderOptions,
	decodeJWT,
	isValidProviderOption,
	isRefreshableOAuth2Client,
	isRefreshableProviderOption,
	isOIDCProviderOption,
	isPKCEProviderOption,
	isRevocableProviderOption,
	isRevocableOAuth2Client
} from 'citra';
