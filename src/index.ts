import { createOAuth2Client } from 'citra';
import { Elysia } from 'elysia';
import { apiKeysRoutes } from './apikeys/routes';
import { agentAuthRoutes } from './agents/routes';
import {
	AGENT_CLAIM_GRANT_TYPE,
	AGENT_IDENTITY_ASSERTION_GRANT_TYPE,
	agentRegistrationDiscoveryMetadata,
	handleAgentTokenGrant
} from './agents/registration';
import { createAuditEmitter } from './audit/config';
import {
	composeCallbackAudit,
	composeCredentialsAudit,
	composeMfaAudit,
	composeRevocationAudit,
	composeSignOutAudit
} from './audit/wrap';
import { createAuthContext } from './authContext';
import { complianceRoutes } from './compliance/routes';
import { credentialRoutes } from './credentials/routes';
import { createConfiguredAuthHtmxRoutes } from './htmx/configuredRoutes';
import { createLockoutGuard } from './lockout/config';
import { createMfaGate } from './mfa/gate';
import { mfaRoutes } from './mfa/routes';
import { oidcProviderRoutes } from './oidc/routes';
import { organizationRoutes } from './organizations/routes';
import { passwordlessRoutes } from './passwordless/routes';
import { portalRoutes } from './portal/routes';
import { roleRoutes } from './roles/routes';
import { pluginDependencySeed } from './pluginIdentity';
import { buildClientProviders } from './providers/clients';
import { authorize } from './routes/authorize';
import { callback } from './routes/callback';
import { profile } from './routes/profile';
import { refresh } from './routes/refresh';
import { revoke } from './routes/revoke';
import { sessionRoutes } from './routes/sessions';
import { signout } from './routes/signout';
import { userStatus } from './routes/userStatus';
import { scimRoutes } from './scim/routes';
import { sessionCleanup } from './session/cleanup';
import { ssoDiscoveryRoute } from './sso/discoveryRoute';
import { oidcSsoRoutes } from './sso/oidcRoutes';
import { samlSsoRoutes } from './sso/samlRoutes';
import { webauthnRoutes } from './webauthn/routes';
import { createWebhookDispatcher } from './webhooks/dispatcher';
import { initTracing } from './telemetry/tracing';
import type { AuthConfig, ClientProviders } from './types';
import { resolveCookieSecure } from './utils';

const validatePositiveOptions = (
	prefix: string,
	options: Record<string, number | undefined>
) => {
	for (const [name, value] of Object.entries(options)) {
		if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
			throw new Error(`${prefix}.${name} must be positive`);
		}
	}
};

const buildAuthApplications = async <UserType>(
	configuration: AuthConfig<UserType>
) => {
	const {
		providersConfiguration,
		authorizeRoute,
		cookieSecure,
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
		customProviders,
		mfa,
		passwordless,
		lockout,
		sessions,
		sso,
		scim,
		apikeys,
		agentAuth,
		oidc,
		organizations,
		roles,
		portal,
		authorization,
		compliance,
		webauthn,
		webhooks,
		htmx,
		tracing,
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
	} = configuration;
	if (agentAuth?.agentRegistration !== undefined) {
		if (oidc === undefined) {
			throw new Error(
				'agentAuth.agentRegistration requires the OIDC provider'
			);
		}
		if (agentAuth.authorizationServer !== oidc.issuer) {
			throw new Error(
				'agentAuth.authorizationServer must equal oidc.issuer'
			);
		}
		const registration = agentAuth.agentRegistration;
		const unknownScopes = [
			...(registration.preClaimScopes ?? []),
			...registration.postClaimScopes
		].filter((scope) => !agentAuth.scopes.includes(scope));
		if (unknownScopes.length > 0) {
			throw new Error(
				`Agent registration uses undeclared scopes: ${[...new Set(unknownScopes)].join(', ')}`
			);
		}
		if (
			registration.allowAnonymous === true &&
			registration.revokeAccessTokens === undefined
		) {
			throw new Error(
				'Anonymous agent registration requires revokeAccessTokens'
			);
		}
		validatePositiveOptions('agentAuth.agentRegistration', {
			assertionTtlMs: registration.assertionTtlMs,
			attemptTtlMs: registration.attemptTtlMs,
			claimTtlMs: registration.claimTtlMs,
			maxAuthenticationAgeMs: registration.maxAuthenticationAgeMs,
			maxCodeAttempts: registration.maxCodeAttempts,
			pollIntervalSeconds: registration.pollIntervalSeconds,
			tokenTtlMs: registration.tokenTtlMs
		});
	}
	if (tracing !== undefined) await initTracing(tracing);
	const clientProviders: ClientProviders = await buildClientProviders(
		providersConfiguration,
		createOAuth2Client,
		customProviders
	);
	const resolvedCookieSecure = resolveCookieSecure(cookieSecure);

	// `webhooks` forwards every emitted event; composing it into the audit emitter means
	// configuring webhooks alone (without `audit`) is enough to turn on event emission.
	const webhookDispatch = webhooks
		? createWebhookDispatcher(webhooks)
		: undefined;
	const auditEmit =
		audit || webhookDispatch
			? createAuditEmitter<UserType>({
					...audit,
					onAuditEvent: async (event) => {
						await audit?.onAuditEvent?.(event);
						await webhookDispatch?.(event);
					}
				})
			: undefined;
	const lockoutGuard = lockout ? createLockoutGuard(lockout) : undefined;
	const resolvedAgentAuth =
		agentAuth === undefined
			? undefined
			: {
					...agentAuth,
					oidcRoute: agentAuth.oidcRoute ?? oidc?.oidcRoute
				};
	const oidcConfig = oidc
		? {
				...oidc,
				additionalDiscoveryMetadata: {
					...oidc.additionalDiscoveryMetadata,
					...(resolvedAgentAuth?.agentRegistration === undefined
						? {}
						: {
								agent_auth:
									agentRegistrationDiscoveryMetadata(
										resolvedAgentAuth
									)
							})
				},
				publicTokenGrantTypes: [
					...(oidc.publicTokenGrantTypes ?? []),
					...(resolvedAgentAuth?.agentRegistration === undefined
						? []
						: [
								AGENT_CLAIM_GRANT_TYPE,
								AGENT_IDENTITY_ASSERTION_GRANT_TYPE
							])
				],
				handlePublicTokenGrant: async (
					context: Parameters<
						NonNullable<typeof oidc.handlePublicTokenGrant>
					>[0]
				) => {
					const consumerResult =
						await oidc.handlePublicTokenGrant?.(context);
					if (consumerResult !== undefined) return consumerResult;
					if (resolvedAgentAuth?.agentRegistration === undefined) {
						return undefined;
					}

					return handleAgentTokenGrant(
						resolvedAgentAuth,
						context.body
					);
				},
				onClientRegistered: async (
					context: Parameters<
						NonNullable<typeof oidc.onClientRegistered>
					>[0]
				) => {
					await oidc.onClientRegistered?.(context);
					if (agentAuth?.registerDynamicClients !== true) return;
					const now = Date.now();
					await agentAuth.registrationStore.saveRegistration({
						agentId: context.client.clientId,
						allowedScopes: context.client.scopes.filter((scope) =>
							agentAuth.scopes.includes(scope)
						),
						clientId: context.client.clientId,
						createdAt: now,
						name: context.client.name,
						status: 'active',
						updatedAt: now
					});
					await auditEmit?.({
						at: now,
						metadata: { agentId: context.client.clientId },
						type: 'agent_registered'
					});
				},
				onDeviceAuthorizationApproved: async (
					context: Parameters<
						NonNullable<typeof oidc.onDeviceAuthorizationApproved>
					>[0]
				) => {
					await oidc.onDeviceAuthorizationApproved?.(context);
					if (agentAuth === undefined) return;
					const registration =
						await agentAuth.registrationStore.findByClientId(
							context.clientId
						);
					if (
						registration === undefined ||
						registration.status !== 'active'
					) {
						return;
					}
					const now = Date.now();
					const existing =
						await agentAuth.delegationStore.findActiveDelegation({
							agentId: registration.agentId,
							now,
							userId: context.userSub
						});
					await agentAuth.delegationStore.saveDelegation({
						agentId: registration.agentId,
						createdAt: existing?.createdAt ?? now,
						delegationId:
							existing?.delegationId ??
							`agd_${crypto.randomUUID()}`,
						scopes: context.scopes.filter(
							(scope) =>
								registration.allowedScopes.includes(scope) &&
								agentAuth.scopes.includes(scope)
						),
						status: 'active',
						updatedAt: now,
						userId: context.userSub
					});
					await auditEmit?.({
						at: now,
						metadata: { agentId: registration.agentId },
						type: 'agent_delegated',
						userId: context.userSub
					});
				}
			}
		: undefined;

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

	const pluginSeed = pluginDependencySeed(configuration);
	const coreRoutes = new Elysia({
		name: '@absolutejs/auth/core-routes',
		seed: pluginSeed
	}).use([
		sessionCleanup<UserType>({
			authSessionStore,
			cleanupIntervalMs,
			maxSessions,
			onSessionCleanup
		}),
		signout({
			authSessionStore,
			onSignOut: auditedOnSignOut,
			signoutRoute
		}),
		revoke({
			authSessionStore,
			clientProviders,
			onRevocationError,
			onRevocationSuccess: auditedOnRevocationSuccess,
			revokeRoute
		}),
		userStatus<UserType>({ authSessionStore, onStatus, statusRoute }),
		refresh({
			authSessionStore,
			clientProviders,
			onRefreshError,
			onRefreshSuccess,
			refreshRoute,
			sessionDurationMs
		}),
		authorize({
			authorizeRoute,
			clientProviders,
			cookieSecure: resolvedCookieSecure,
			onAuthorizeError,
			onAuthorizeSuccess
		}),
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
		}),
		profile({
			clientProviders,
			onProfileError,
			onProfileSuccess,
			profileRoute
		})
	]);

	const featureRoutes = new Elysia({
		name: '@absolutejs/auth/feature-routes',
		seed: pluginSeed
	}).use([
		auditedCredentials
			? credentialRoutes<UserType>({
					...auditedCredentials,
					authSessionStore,
					cookieSecure: resolvedCookieSecure,
					lockoutGuard
				})
			: new Elysia(),
		auditedMfa
			? mfaRoutes<UserType>({
					...auditedMfa,
					authSessionStore,
					cookieSecure: resolvedCookieSecure
				})
			: new Elysia(),
		passwordless
			? passwordlessRoutes<UserType>({
					...passwordless,
					authSessionStore,
					cookieSecure: resolvedCookieSecure,
					emit: auditEmit
				})
			: new Elysia(),
		sessions
			? sessionRoutes<UserType>({ ...sessions, authSessionStore })
			: new Elysia(),
		sso
			? oidcSsoRoutes<UserType>({
					...sso,
					authSessionStore,
					cookieSecure: resolvedCookieSecure
				})
			: new Elysia(),
		sso && sso.samlAdapter
			? samlSsoRoutes<UserType>({
					...sso,
					authSessionStore,
					cookieSecure: resolvedCookieSecure,
					samlAdapter: sso.samlAdapter
				})
			: new Elysia(),
		sso && sso.getOrganizationByEmailDomain
			? ssoDiscoveryRoute({
					getOrganizationByEmailDomain:
						sso.getOrganizationByEmailDomain,
					ssoConnectionStore: sso.ssoConnectionStore,
					ssoRoute: sso.ssoRoute
				})
			: new Elysia(),
		scim ? scimRoutes(scim) : new Elysia(),
		apikeys ? apiKeysRoutes(apikeys) : new Elysia(),
		oidcConfig
			? oidcProviderRoutes<UserType>({
					...oidcConfig,
					authSessionStore
				})
			: new Elysia(),
		organizations
			? organizationRoutes<UserType>({
					...organizations,
					authSessionStore,
					emit: auditEmit
				})
			: new Elysia(),
		roles
			? roleRoutes<UserType>({
					...roles,
					authSessionStore,
					emit: auditEmit
				})
			: new Elysia(),
		portal ? portalRoutes({ ...portal, emit: auditEmit }) : new Elysia(),
		webauthn
			? webauthnRoutes<UserType>({
					...webauthn,
					authSessionStore,
					cookieSecure: resolvedCookieSecure,
					emit: auditEmit
				})
			: new Elysia(),
		compliance
			? complianceRoutes<UserType>({
					...compliance,
					authSessionStore,
					emit: auditEmit
				})
			: new Elysia(),
		createConfiguredAuthHtmxRoutes({ authSessionStore, config: htmx }),
		agentAuthRoutes(resolvedAgentAuth)
	]);

	const authContext = createAuthContext<UserType>({
		agentAuth: resolvedAgentAuth,
		authorization,
		authSessionStore,
		emit: auditEmit,
		seedSource: configuration
	});

	return { authContext, coreRoutes, featureRoutes };
};

export const auth = async <UserType>(configuration: AuthConfig<UserType>) => {
	const { authContext, coreRoutes, featureRoutes } =
		await buildAuthApplications(configuration);
	const application = new Elysia({
		name: '@absolutejs/auth',
		seed: pluginDependencySeed(configuration)
	});

	application.use(coreRoutes);
	application.use(featureRoutes);

	return application.use(authContext);
};

export const createAuthApplications = async <UserType>(
	configuration: AuthConfig<UserType>
) => buildAuthApplications(configuration);

export * from './actions';
export type AuthApplications<UserType> = Awaited<
	ReturnType<typeof createAuthApplications<UserType>>
>;
export { createAuthContext } from './authContext';
export type { AuthInstance } from './authContext';
export * from './types';
export * from './typebox';
export * from './vault/config';
export * from './vault/types';
export { createInMemoryVaultStore } from './vault/inMemoryVaultStore';
export {
	createNeonVaultStore,
	createPostgresVaultStore,
	vaultEntriesTable
} from './vault/postgresVaultStore';
export {
	createFederatedTokenStore,
	getOrRefreshFederatedTokens
} from './federation/tokenStore';
export type {
	FederatedTokenRefresher,
	FederatedTokenSet,
	FederatedTokenStore
} from './federation/tokenStore';
export type { AuthSessionStore } from './session/types';
export { isAuthIntent, isUserSessionId, isValidUser } from './typeGuards';
export { AuthIdentityConflictError } from './errors';
export { sessionStore } from './session/state';
export { createInMemoryAuthSessionStore } from './session/inMemoryStore';
export { createNeonAuthSessionStore } from './session/neonStore';
export { providersFromEnv, type ProviderSelection } from './providersFromEnv';
export {
	createRedisAuthSessionStore,
	type RedisSessionClient
} from './session/redisStore';
export { createLinkedProviderCredentialResolver } from './linkedProviders/resolver';
export { createOAuthLinkedProviderCredentialResolver } from './linkedProviders/oauthResolver';
export {
	createOAuthAccountLinkedProviderCredentialResolver,
	type OAuthLinkedProviderAccount,
	type OAuthLinkedProviderAccountStore
} from './linkedProviders/oauthAccountResolver';
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
	endImpersonation,
	isImpersonating,
	startImpersonation
} from './session/impersonation';
export {
	createAnonymousSession,
	isAnonymousSession
} from './session/anonymous';
export {
	addToSessionRing,
	listRingSessions,
	readSessionRing,
	removeFromSessionRing,
	switchActiveSession
} from './session/multiSession';
export {
	listUserSessions,
	refreshUserSessions,
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
	OAuth2ClientForConfig,
	CustomProviderCredentials,
	ProviderConfig,
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
	createCustomOAuth2Client,
	defineProvider,
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
export * from './credentials/backgroundOps';
export * from './credentials/emailValidation';
export {
	importUser,
	importUsers,
	rehashCredentialPassword
} from './credentials/import';
export type {
	ImportUserResult,
	ImportUsersOptions,
	ImportableUser
} from './credentials/import';
export {
	isLegacyHash,
	verifyAuth0Pbkdf2,
	verifyCognitoSha256
} from './credentials/legacyHashers';
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
export { mfaManagementRoutes, type MfaStatus } from './mfa/management';
export { rotateMfaEncryptionKey } from './mfa/rotation';
export type { MfaKeyRotationResult } from './mfa/rotation';
export { mfaTotpRoutes } from './mfa/totp';
export { isE164Phone, maskPhone, mfaSmsRoutes } from './mfa/sms';
export { decryptTotpSecret, encryptTotpSecret } from './mfa/secret';
export { createInMemoryMfaStore } from './mfa/inMemoryMfaStore';
export {
	createNeonMfaStore,
	createPostgresMfaStore,
	mfaEnrollmentsTable
} from './mfa/postgresMfaStore';

export * from './audit/config';
export * from './audit/types';
export {
	createTamperEvidentSink,
	hashAuditEvent,
	verifyAuditChain
} from './audit/integrity';
export type { AuditChainResult, AuditIntegrity } from './audit/integrity';
export { createSiemLogStream } from './audit/siem';
export type { SiemEndpoint, SiemFormat } from './audit/siem';
export * from './abuse/captcha';
export * from './abuse/config';
export * from './authorization/config';
export { protectPermissionPlugin } from './authorization/protectPermission';
export * from './compliance/config';
export { complianceRoutes } from './compliance/routes';
export { createAuditRedactor } from './compliance/redaction';
export { createSecretCipher } from './compliance/cipher';
export type { SecretCipher } from './compliance/cipher';
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
export { exportAuditCsv } from './audit/export';
export { createInMemoryAuditSink } from './audit/inMemoryAuditStore';
export {
	auditEventsTable,
	createNeonAuditSink,
	createPostgresAuditSink
} from './audit/postgresAuditStore';
export * from './sso/types';
export * from './sso/config';
export * from './scim/types';
export * from './scim/config';
export * from './scim/extensions';
export { scimRoutes } from './scim/routes';
export * from './vc/sdJwt';
export {
	buildIssuerMetadata,
	createCredentialOffer,
	DEFAULT_VCI_ROUTE,
	exchangePreAuthorizedCode,
	issueCredential,
	PRE_AUTHORIZED_CODE_GRANT
} from './oidc/vci';
export type {
	CredentialConfiguration,
	CredentialIssueInput,
	CredentialIssueResult,
	CredentialNonceRecord,
	CredentialNonceStore,
	CredentialOffer,
	CredentialOfferStore,
	PreAuthExchangeResult,
	VciConfig
} from './oidc/vci';
export {
	createInMemoryCredentialNonceStore,
	createInMemoryCredentialOfferStore
} from './oidc/inMemoryVciStores';
export { vciRoutes } from './oidc/vciRoutes';
export * from './vc/statusList';
export { statusListRoutes, DEFAULT_STATUS_ROUTE } from './vc/statusListRoutes';
export {
	buildHolderKeyBindingJwt,
	createPresentationRequest,
	parsePresentationToken,
	verifyPresentationResponse
} from './vc/openid4vp';
export type {
	CreatePresentationRequestInput,
	PresentationRequest,
	PresentationRequestStore,
	PresentationResponseInput,
	PresentationVerifyError,
	PresentationVerifyResult,
	VerifiedPresentation,
	Vp4Config
} from './vc/openid4vp';
export { createInMemoryPresentationRequestStore } from './vc/inMemoryVpStores';
export { vpRoutes, DEFAULT_VP_ROUTE } from './vc/vpRoutes';
export {
	createNeonCredentialNonceStore,
	createNeonCredentialOfferStore,
	createNeonPresentationRequestStore,
	createPostgresCredentialNonceStore,
	createPostgresCredentialOfferStore,
	createPostgresPresentationRequestStore,
	vcCredentialNoncesTable,
	vcCredentialOffersTable,
	vcPresentationRequestsTable
} from './vc/postgresVcStores';
export { createInMemoryScimTokenStore } from './scim/inMemoryScimTokenStore';
export {
	createNeonScimTokenStore,
	createPostgresScimTokenStore,
	scimTokensTable
} from './scim/postgresScimTokenStore';
export * from './apikeys/config';
export * from './apikeys/types';
export { apiKeysRoutes } from './apikeys/routes';
export * from './agents/config';
export * from './agents/types';
export * from './agents/registration';
export * from './agents/registrationClient';
export * from './agents/idJag';
export { agentAuthPlugin, agentAuthChallenge } from './agents/routes';
export { resolveAgentPrincipal, agentHasScopes } from './agents/principal';
export { createOidcAgentCredentialVerifier } from './agents/oidcAdapter';
export {
	createInMemoryAgentDelegationStore,
	createInMemoryAgentIdentityRegistrationStore,
	createInMemoryAgentRegistrationStore
} from './agents/inMemoryStores';
export {
	agentDelegationsTable,
	agentIdentityRegistrationsTable,
	agentRegistrationsTable,
	createNeonAgentDelegationStore,
	createNeonAgentIdentityRegistrationStore,
	createNeonAgentRegistrationStore,
	createPostgresAgentDelegationStore,
	createPostgresAgentIdentityRegistrationStore,
	createPostgresAgentRegistrationStore
} from './agents/postgresStores';
export {
	createInMemoryAccessTokenStore,
	createInMemoryApiClientStore,
	createInMemoryApiKeyStore
} from './apikeys/inMemoryStores';
export {
	accessTokensTable,
	apiClientsTable,
	apiKeysTable,
	createNeonAccessTokenStore,
	createNeonApiClientStore,
	createNeonApiKeyStore,
	createPostgresAccessTokenStore,
	createPostgresApiClientStore,
	createPostgresApiKeyStore
} from './apikeys/postgresStores';
export * from './oidc/config';
export * from './oidc/clientIdMetadata';
export * from './oidc/types';
export { oidcProviderRoutes } from './oidc/routes';
export {
	generateSigningKey,
	jwkThumbprint,
	signJwt,
	toPublicJwk,
	verifyJwt
} from './oidc/keys';
export type { SigningKey } from './oidc/keys';
export {
	extractDpopNonceClaim,
	mintDpopNonce,
	verifyDpopNonce,
	verifyDpopProof
} from './oidc/dpop';
export type { DpopResult } from './oidc/dpop';
export {
	CLIENT_ASSERTION_TYPE,
	verifyClientAssertion,
	verifyJwtSignedByClient
} from './oidc/clientAuth';
export { parseSignedRequestObject } from './oidc/jar';
export type { JarParseResult } from './oidc/jar';
export {
	computeCertThumbprint,
	extractRfc9440ClientCert,
	resolveClientCert,
	verifyCertificateBoundToken
} from './oidc/mtls';
export {
	createInMemoryAuthorizationCodeStore,
	createInMemoryBackchannelAuthStore,
	createInMemoryClientAssertionJtiStore,
	createInMemoryClientRegistrationTokenStore,
	createInMemoryDeviceAuthorizationStore,
	createInMemoryInitialAccessTokenStore,
	createInMemoryLogoutDeliveryStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore,
	createInMemoryPushedAuthorizationRequestStore
} from './oidc/inMemoryStores';
export {
	consumePushedRequest,
	pushAuthorizationRequest,
	DEFAULT_PAR_TTL_MS,
	REQUEST_URI_PREFIX
} from './oidc/par';
export {
	fetchUserInfo,
	readUserInfoBearer,
	userInfoChallengeHeader
} from './oidc/userinfo';
export type { UserInfoResult } from './oidc/userinfo';
export {
	fanOutBackchannelLogout,
	mintLogoutToken,
	resolvePostLogoutRedirect,
	verifyIdTokenHint
} from './oidc/logout';
export {
	createNeonAuthorizationCodeStore,
	createNeonBackchannelAuthStore,
	createNeonClientAssertionJtiStore,
	createNeonClientRegistrationTokenStore,
	createNeonDeviceAuthorizationStore,
	createNeonInitialAccessTokenStore,
	createNeonLogoutDeliveryStore,
	createNeonOAuthClientStore,
	createNeonOidcRefreshTokenStore,
	createNeonPushedAuthorizationRequestStore,
	createPostgresAuthorizationCodeStore,
	createPostgresBackchannelAuthStore,
	createPostgresClientAssertionJtiStore,
	createPostgresClientRegistrationTokenStore,
	createPostgresDeviceAuthorizationStore,
	createPostgresInitialAccessTokenStore,
	createPostgresLogoutDeliveryStore,
	createPostgresOAuthClientStore,
	createPostgresOidcRefreshTokenStore,
	createPostgresPushedAuthorizationRequestStore,
	oauthClientAssertionJtisTable,
	oauthClientRegistrationTokensTable,
	oauthClientsTable,
	oauthCodesTable,
	oauthBackchannelAuthRequestsTable,
	oauthDeviceAuthorizationsTable,
	oauthInitialAccessTokensTable,
	oauthLogoutDeliveriesTable,
	oauthPushedAuthorizationRequestsTable,
	oauthRefreshTokensTable
} from './oidc/postgresStores';
export {
	deleteRegisteredClient,
	getRegisteredClient,
	registerClient,
	updateRegisteredClient,
	type ClientRegistrationDecision,
	type ClientRegistrationMetadata,
	type OnClientRegistration,
	type RegisterClientResult
} from './oidc/registration';
export * from './adaptive/config';
export * from './adaptive/fingerprint';
export * from './adaptive/types';
export {
	createInMemoryKnownDeviceStore,
	createInMemoryLoginHistoryStore
} from './adaptive/inMemoryStores';
export {
	createNeonKnownDeviceStore,
	createNeonLoginHistoryStore,
	createPostgresKnownDeviceStore,
	createPostgresLoginHistoryStore,
	knownDevicesTable,
	loginHistoryTable
} from './adaptive/postgresStores';
export * from './fga/config';
export * from './fga/schema';
export * from './fga/types';
export { createInMemoryWarrantStore, warrantKey } from './fga/inMemoryStores';
export {
	createRedisFgaCache,
	type RedisFgaCacheClient
} from './fga/redisCheckCache';
export { initTracing, withSpan, type TracingConfig } from './telemetry/tracing';
export {
	blockMigrations,
	runMigrations,
	type BlockMigrations,
	type BlockName,
	type Migration
} from './migrations';
export type {
	MigrationRunResult,
	RunMigrationsOptions
} from './migrations/runner';
export {
	createNeonWarrantStore,
	createPostgresWarrantStore,
	warrantsTable
} from './fga/postgresStores';
export { ssoDiscoveryRoute } from './sso/discoveryRoute';
export { oidcSsoRoutes } from './sso/oidcRoutes';
export { samlIdpRoutes } from './sso/samlIdpRoutes';
export { samlSsoRoutes } from './sso/samlRoutes';
export { createInMemorySamlServiceProviderStore } from './sso/inMemorySamlServiceProviderStore';
export { createInMemorySsoConnectionStore } from './sso/inMemorySsoConnectionStore';
export {
	createNeonSamlServiceProviderStore,
	createPostgresSamlServiceProviderStore,
	samlServiceProvidersTable
} from './sso/postgresSamlServiceProviderStore';
export {
	createNeonSsoConnectionStore,
	createPostgresSsoConnectionStore,
	ssoConnectionsTable
} from './sso/postgresSsoConnectionStore';
export * from './webauthn/adapter';
export * from './webauthn/config';
export * from './webauthn/types';
export { webauthnRoutes } from './webauthn/routes';
export { createInMemoryWebAuthnCredentialStore } from './webauthn/inMemoryWebAuthnCredentialStore';
export {
	createNeonWebAuthnCredentialStore,
	createPostgresWebAuthnCredentialStore,
	webauthnCredentialsTable
} from './webauthn/postgresWebAuthnCredentialStore';
export * from './organizations/config';
export * from './organizations/types';
export {
	acceptInvitation,
	createOrganization,
	inviteToOrganization,
	listUserOrganizations
} from './organizations/operations';
export { organizationRoutes } from './organizations/routes';
export { createInMemoryOrganizationStore } from './organizations/inMemoryOrganizationStore';
export {
	createNeonOrganizationStore,
	createPostgresOrganizationStore,
	organizationInvitationsTable,
	organizationMembershipsTable,
	organizationsTable
} from './organizations/postgresOrganizationStore';
export * from './roles/config';
export * from './roles/types';
export {
	createMembershipPermissionResolver,
	resolvePermissions
} from './roles/resolver';
export { setMemberRoles } from './roles/operations';
export { roleRoutes } from './roles/routes';
export { createInMemoryRoleStore } from './roles/inMemoryRoleStore';
export {
	createNeonRoleStore,
	createPostgresRoleStore,
	rolesTable
} from './roles/postgresRoleStore';
export * from './passwordless/config';
export * from './passwordless/types';
export { passwordlessRoutes } from './passwordless/routes';
export { createInMemoryPasswordlessTokenStore } from './passwordless/inMemoryPasswordlessTokenStore';
export {
	createNeonPasswordlessTokenStore,
	createPostgresPasswordlessTokenStore,
	passwordlessTokensTable
} from './passwordless/postgresPasswordlessTokenStore';
export * from './webhooks/config';
export * from './webhooks/types';
export { createWebhookDispatcher } from './webhooks/dispatcher';
export { createInMemoryWebhookDeliveryStore } from './webhooks/inMemoryStore';
export {
	createNeonWebhookDeliveryStore,
	createPostgresWebhookDeliveryStore,
	webhookDeliveriesTable
} from './webhooks/postgresStore';
export { signWebhook, verifyWebhookSignature } from './webhooks/sign';
export * from './portal/config';
export * from './portal/types';
export { createSetupSession, resolveSetupSession } from './portal/operations';
export { portalRoutes } from './portal/routes';
export { createInMemorySetupSessionStore } from './portal/inMemorySetupSessionStore';
export {
	createNeonSetupSessionStore,
	createPostgresSetupSessionStore,
	setupSessionsTable
} from './portal/postgresSetupSessionStore';
