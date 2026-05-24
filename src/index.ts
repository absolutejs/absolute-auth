import { createOAuth2Client } from 'citra';
import { Elysia } from 'elysia';
import { authorize } from './authorize';
import { callback } from './callback';
import { createAuthHtmxRoutes } from './htmxRoutes';
import { buildClientProviders } from './providerClients';
import { profile } from './profile';
import { protectRoutePlugin } from './protectRoute';
import { refresh } from './refresh';
import { revoke } from './revoke';
import { sessionCleanup } from './sessionCleanup';
import { signout } from './signout';
import { AbsoluteAuthProps, ClientProviders } from './types';
import type { AuthHtmxUser } from './ui/types';
import { userStatus } from './userStatus';

export const absoluteAuth = async <UserType extends AuthHtmxUser>({
	providersConfiguration,
	authorizeRoute,
	callbackRoute,
	profileRoute,
	signoutRoute,
	statusRoute,
	refreshRoute,
	revokeRoute,
	cleanupIntervalMs,
	maxSessions,
	sessionDurationMs,
	authSessionStore,
	htmx,
	resolveAuthIntent,
	onAuthorizeSuccess,
	onAuthorizeError,
	onProfileSuccess,
	onProfileError,
	onCallbackSuccess,
	onLinkIdentity,
	onLinkIdentityConflict,
	onLinkConnector,
	onCallbackError,
	onStatus,
	onRefreshSuccess,
	onRefreshError,
	onSignOut,
	onRevocationSuccess,
	onRevocationError,
	onSessionCleanup
}: AbsoluteAuthProps<UserType>) => {
	const clientProviders: ClientProviders = await buildClientProviders(
		providersConfiguration,
		createOAuth2Client
	);

	return new Elysia()
		.use(
			sessionCleanup<UserType>({
				authSessionStore,
				cleanupIntervalMs,
				maxSessions,
				onSessionCleanup
			})
		)
		.use(signout({ authSessionStore, onSignOut, signoutRoute }))
		.use(
			revoke({
				authSessionStore,
				clientProviders,
				onRevocationError,
				onRevocationSuccess,
				revokeRoute
			})
		)
		.use(userStatus<UserType>({ authSessionStore, onStatus, statusRoute }))
		.use(
			refresh({
				authSessionStore,
				clientProviders,
				onRefreshError,
				onRefreshSuccess,
				refreshRoute,
				sessionDurationMs
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
				authSessionStore,
				callbackRoute,
				clientProviders,
				resolveAuthIntent,
				onCallbackError,
				onCallbackSuccess,
				onLinkIdentity,
				onLinkIdentityConflict,
				onLinkConnector
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
		.use(protectRoutePlugin<UserType>({ authSessionStore }))
		.use(
			htmx
				? createAuthHtmxRoutes<UserType>({ ...htmx, authSessionStore })
				: new Elysia()
		);
};

export * from './types';
export * from './typebox';
export type { AbsoluteAuthSessionStore } from './sessionTypes';
export { isAuthIntent, isUserSessionId, isValidUser } from './typeGuards';
export { AbsoluteAuthIdentityConflictError } from './errors';
export { sessionStore } from './sessionStore';
export { createInMemoryAuthSessionStore } from './authSessionStores';
export { createNeonAuthSessionStore } from './neonAuthSessionStore';
export { createLinkedProviderCredentialResolver } from './linkedProviderResolver';
export { createOAuthLinkedProviderCredentialResolver } from './oauthLinkedProviderResolver';
export {
	createNeonLinkedProviderStores,
	createNeonOAuthLinkedProviderCredentialResolver
} from './neonLinkedProviders';
export { createInMemoryLinkedProviderStores } from './linkedProviderStores';
export { protectRoutePlugin } from './protectRoute';
export { sessionCleanup } from './sessionCleanup';
export { createAuthHtmxRoutes } from './htmxRoutes';
export { resolveAuthHtmxRenderers } from './ui/renderers';
export type {
	AuthHtmxConfig,
	AuthHtmxConnectorTarget,
	AuthHtmxProviderData,
	AuthHtmxProviderInfo,
	AuthHtmxRenderOverrides,
	AuthHtmxRenderersConfig,
	AuthHtmxUser,
	AuthIdentityPayload,
	LinkedProviderPayload
} from './ui/types';
export * from './utils';
export {
	buildClientProviders,
	resolveClientProviderEntry,
	resolveProviderClientConfiguration
} from './providerClients';
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
