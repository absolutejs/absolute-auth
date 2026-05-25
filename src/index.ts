import { createOAuth2Client } from 'citra';
import { Elysia } from 'elysia';
import { createAuditEmitter } from './audit/config';
import {
	composeCallbackAudit,
	composeCredentialsAudit,
	composeMfaAudit,
	composeRevocationAudit,
	composeSignOutAudit
} from './audit/wrap';
import { credentialRoutes } from './credentials/routes';
import { createAuthHtmxRoutes } from './htmx/routes';
import { createLockoutGuard } from './lockout/config';
import { createMfaGate } from './mfa/gate';
import { mfaRoutes } from './mfa/routes';
import type { AuthHtmxConfig, AuthHtmxUser } from './htmx/types';
import { buildClientProviders } from './providers/clients';
import { authorize } from './routes/authorize';
import { callback } from './routes/callback';
import { profile } from './routes/profile';
import { protectRoutePlugin } from './routes/protectRoute';
import { refresh } from './routes/refresh';
import { revoke } from './routes/revoke';
import { sessionRoutes } from './routes/sessions';
import { stepUpPlugin } from './routes/stepUp';
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
	audit,
	credentials,
	mfa,
	lockout,
	sessions,
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

	const auditEmit = audit ? createAuditEmitter(audit) : undefined;
	const lockoutGuard = lockout ? createLockoutGuard(lockout) : undefined;

	// When both blocks are configured, default the login MFA gate to the MFAStore
	// enrollment check unless the consumer supplied their own.
	const credentialsConfig = credentials
		? {
				...credentials,
				isMfaRequired:
					credentials.isMfaRequired ??
					(mfa ? createMfaGate(mfa) : undefined)
			}
		: undefined;
	const auditedCredentials =
		credentialsConfig && auditEmit
			? composeCredentialsAudit(
					credentialsConfig,
					auditEmit,
					audit?.getUserId
				)
			: credentialsConfig;
	const auditedMfa = mfa && auditEmit ? composeMfaAudit(mfa, auditEmit) : mfa;
	const auditedOnCallbackSuccess = auditEmit
		? composeCallbackAudit(onCallbackSuccess, auditEmit)
		: onCallbackSuccess;
	const auditedOnRevocationSuccess = auditEmit
		? composeRevocationAudit(onRevocationSuccess, auditEmit)
		: onRevocationSuccess;
	const auditedOnSignOut = auditEmit
		? composeSignOutAudit(onSignOut, auditEmit)
		: onSignOut;

	return new Elysia()
		.use(
			sessionCleanup<UserType>({
				authSessionStore,
				cleanupIntervalMs,
				maxSessions,
				onSessionCleanup
			})
		)
		.use(
			signout({
				authSessionStore,
				onSignOut: auditedOnSignOut,
				signoutRoute
			})
		)
		.use(
			revoke({
				authSessionStore,
				clientProviders,
				onRevocationError,
				onRevocationSuccess: auditedOnRevocationSuccess,
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
				onCallbackSuccess: auditedOnCallbackSuccess,
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
		.use(
			auditedCredentials
				? credentialRoutes<UserType>({
						...auditedCredentials,
						authSessionStore,
						lockoutGuard
					})
				: new Elysia()
		)
		.use(
			auditedMfa
				? mfaRoutes<UserType>({ ...auditedMfa, authSessionStore })
				: new Elysia()
		)
		.use(
			sessions
				? sessionRoutes<UserType>({ ...sessions, authSessionStore })
				: new Elysia()
		)
		.use(protectRoutePlugin<UserType>({ authSessionStore }))
		.use(stepUpPlugin<UserType>({ authSessionStore }))
		.use(
			// `htmx` is gated to `UserType extends AuthHtmxUser` at the public
			// API (AuthConfig), so this bridge is sound — TS just can't
			// re-derive the bound inside an unconstrained generic body.
			htmx
				? createAuthHtmxRoutes<UserType & AuthHtmxUser>({
						// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- sound at the public API; TS can't re-derive the bound in this unconstrained generic body
						...(htmx as AuthHtmxConfig),
						// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- sound at the public API; TS can't re-derive the bound in this unconstrained generic body
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
export { sessionRoutes } from './routes/sessions';
export { stepUpPlugin } from './routes/stepUp';
export * from './session/sessionsConfig';
export {
	listUserSessions,
	revokeUserSessions
} from './session/userSessions';
export type { UserSession } from './session/userSessions';
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

export * from './crypto';
export * from './tenancy';
export * from './credentials/config';
export * from './credentials/passwordPolicy';
export * from './credentials/types';
export { credentialRoutes } from './credentials/routes';
export { credentialsEmailVerification } from './credentials/emailVerification';
export { credentialsLogin } from './credentials/login';
export { credentialsPasswordReset } from './credentials/passwordReset';
export { credentialsRegister } from './credentials/register';
export { createInMemoryCredentialStore } from './credentials/inMemoryCredentialStore';
export {
	createNeonCredentialStore,
	createPostgresCredentialStore,
	credentialResetTokensTable,
	credentialsTable,
	credentialVerificationTokensTable
} from './credentials/postgresCredentialStore';
export { createNeonDatabase } from './stores/postgres';
export type { AnyPgDatabase } from './stores/postgres';

export * from './mfa/config';
export * from './mfa/types';
export { consumeBackupCode, generateBackupCodes } from './mfa/backupCodes';
export { createMfaGate } from './mfa/gate';
export { mfaChallenge } from './mfa/challenge';
export { mfaRoutes } from './mfa/routes';
export { mfaTotpRoutes } from './mfa/totp';
export { decryptTotpSecret, encryptTotpSecret } from './mfa/secret';
export { createInMemoryMfaStore } from './mfa/inMemoryMfaStore';
export {
	createNeonMfaStore,
	createPostgresMfaStore,
	mfaEnrollmentsTable
} from './mfa/postgresMfaStore';

export * from './audit/config';
export * from './audit/types';
export * from './lockout/config';
export * from './lockout/types';
export { createInMemoryLockoutStore } from './lockout/inMemoryLockoutStore';
export {
	createNeonLockoutStore,
	createPostgresLockoutStore,
	lockoutsTable
} from './lockout/postgresLockoutStore';
export { createRedisLockoutStore } from './lockout/redisLockoutStore';
export type { RedisLike } from './stores/redis';
export { createInMemoryAuditSink } from './audit/inMemoryAuditStore';
export {
	auditEventsTable,
	createNeonAuditSink,
	createPostgresAuditSink
} from './audit/postgresAuditStore';
export * from './sso/types';
export { createInMemorySsoConnectionStore } from './sso/inMemorySsoConnectionStore';
export {
	createNeonSsoConnectionStore,
	createPostgresSsoConnectionStore,
	ssoConnectionsTable
} from './sso/postgresSsoConnectionStore';
