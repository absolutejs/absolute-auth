import { createOAuth2Client } from 'citra';
import { Elysia } from 'elysia';
import { createAuthHtmxRoutes } from './htmx/routes';
import type { AuthHtmxConfig, AuthHtmxUser } from './htmx/types';
import { buildClientProviders } from './providers/clients';
import { authorize } from './routes/authorize';
import { callback } from './routes/callback';
import { profile } from './routes/profile';
import { protectRoutePlugin } from './routes/protectRoute';
import { refresh } from './routes/refresh';
import { revoke } from './routes/revoke';
import { signout } from './routes/signout';
import { userStatus } from './routes/userStatus';
import { sessionCleanup } from './session/cleanup';
import type { AuthSessionStore } from './session/types';
import { AuthConfig, ClientProviders } from './types';

export const auth = async <UserType>({
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
}: AuthConfig<UserType>) => {
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
				onCallbackError,
				onCallbackSuccess,
				onLinkConnector,
				onLinkIdentity,
				onLinkIdentityConflict,
				resolveAuthIntent
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
			// `htmx` is gated to `UserType extends AuthHtmxUser` at the public
			// API (AuthConfig), so this bridge is sound — TS just can't
			// re-derive the bound inside an unconstrained generic body.
			htmx
				? createAuthHtmxRoutes<UserType & AuthHtmxUser>({
						...(htmx as AuthHtmxConfig),
						authSessionStore: authSessionStore as
							| AuthSessionStore<UserType & AuthHtmxUser>
							| undefined
					})
				: new Elysia()
		);
};

export * from './types';
export * from './typebox';
export type { AuthSessionStore } from './session/types';
export { isAuthIntent, isUserSessionId, isValidUser } from './typeGuards';
export { AuthIdentityConflictError } from './errors';
export { sessionStore } from './session/state';
export { createInMemoryAuthSessionStore } from './session/inMemoryStore';
export { createNeonAuthSessionStore } from './session/neonStore';
export { createLinkedProviderCredentialResolver } from './linkedProviders/resolver';
export { createOAuthLinkedProviderCredentialResolver } from './linkedProviders/oauthResolver';
export {
	createNeonLinkedProviderStores,
	createNeonOAuthLinkedProviderCredentialResolver
} from './linkedProviders/neonStores';
export { createInMemoryLinkedProviderStores } from './linkedProviders/inMemoryStores';
export { protectRoutePlugin } from './routes/protectRoute';
export { sessionCleanup } from './session/cleanup';
export { createAuthHtmxRoutes } from './htmx/routes';
export { resolveAuthHtmxRenderers } from './htmx/renderers';
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
} from './htmx/types';
export * from './utils';
export {
	buildClientProviders,
	resolveClientProviderEntry,
	resolveProviderClientConfiguration
} from './providers/clients';
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
