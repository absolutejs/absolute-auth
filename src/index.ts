import { isValidProviderOption, createOAuth2Client } from 'citra';
import { Elysia } from 'elysia';
import { authorize } from './authorize';
import { callback } from './callback';
import { profile } from './profile';
import { protectRoutePlugin } from './protectRoute';
import { refresh } from './refresh';
import { revoke } from './revoke';
import { sessionCleanupPlugin } from './sessionCleanupPlugin';
import { signout } from './signout';
import { AbsoluteAuthProps, ClientProviders, OnSessionCleanup } from './types';
import { userStatus } from './userStatus';

export const absoluteAuth = async <UserType>({
	providersConfiguration,
	authorizeRoute,
	callbackRoute,
	profileRoute,
	signoutRoute,
	statusRoute,
	refreshRoute,
	revokeRoute,
	onAuthorizeSuccess,
	onAuthorizeError,
	onProfileSuccess,
	onProfileError,
	onCallbackSuccess,
	onCallbackError,
	onStatus,
	onRefreshSuccess,
	onRefreshError,
	onSignOut,
	onRevocationSuccess,
	onRevocationError,
	onSessionCleanup,
	cleanupIntervalMs,
	maxSessions
}: AbsoluteAuthProps<UserType> & {
	onSessionCleanup?: OnSessionCleanup<UserType>;
	cleanupIntervalMs?: number;
	maxSessions?: number;
}) => {
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
		.use(
			sessionCleanupPlugin<UserType>({
				cleanupIntervalMs,
				maxSessions,
				onSessionCleanup
			})
		)
		.use(signout({ onSignOut, signoutRoute }))
		.use(
			revoke({
				clientProviders,
				onRevocationError,
				onRevocationSuccess,
				revokeRoute
			})
		)
		.use(userStatus<UserType>({ onStatus, statusRoute }))
		.use(
			refresh({
				clientProviders,
				onRefreshError,
				onRefreshSuccess,
				refreshRoute
			})
		)
		.use(
			authorize({
				authorizeRoute,
				clientProviders,
				onAuthorizeError,
				onAuthorizeSuccess
			})
		)
		.use(
			callback<UserType>({
				callbackRoute,
				clientProviders,
				onCallbackError,
				onCallbackSuccess
			})
		)
		.use(
			profile({
				clientProviders,
				onProfileError,
				onProfileSuccess,
				profileRoute
			})
		)
		.use(protectRoutePlugin<UserType>());
};

export * from './types';
export * from './typebox';
export { isUserSessionId, isValidUser } from './typeGuards';
export { sessionStore } from './sessionStore';
export { protectRoutePlugin } from './protectRoute';
export { sessionCleanupPlugin } from './sessionCleanupPlugin';
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
	ProvidersMap,
	ProviderConfiguration,
	CredentialsFor
} from 'citra';

export {
	providers,
	providerOptions,
	refreshableProviderOptions,
	revocableProviderOptions,
	oidcProviderOptions,
	pkceProviderOptions,
	scopeRequiredProviderOptions,
	decodeJWT,
	extractPropFromIdentity,
	isValidProviderOption,
	isRefreshableOAuth2Client,
	isRefreshableProviderOption,
	isOIDCProviderOption,
	isPKCEProviderOption,
	isRevocableProviderOption,
	isRevocableOAuth2Client
} from 'citra';
