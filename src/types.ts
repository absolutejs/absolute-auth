import {
	CredentialsFor,
	NonEmptyArray,
	OAuth2Client,
	OAuth2TokenResponse,
	ProviderOption,
	ProvidersMap
} from 'citra';
import { Cookie, status as statusType, redirect as redirectType } from 'elysia';
import { ElysiaCustomStatusResponse } from 'elysia/error';
import type { ApiKeysConfig } from './apikeys/config';
import type { AuditConfig } from './audit/config';
import type { AuthorizationConfig } from './authorization/config';
import type { ComplianceConfig } from './compliance/config';
import type { CredentialsConfig } from './credentials/config';
import type { AuthIdentityConflict } from './errors';
import type { AuthHtmxConfig, AuthHtmxUser } from './htmx/types';
import type { LockoutConfig } from './lockout/config';
import type { MfaConfig } from './mfa/config';
import type { OidcProviderConfig } from './oidc/config';
import type { OrganizationsConfig } from './organizations/config';
import type { PasswordlessConfig } from './passwordless/config';
import type { PortalConfig } from './portal/config';
import type { RolesConfig } from './roles/config';
import type { ScimConfig } from './scim/config';
import type { SessionsConfig } from './session/sessionsConfig';
import type { AuthSessionStore } from './session/types';
import type { SSOConfig } from './sso/config';
import type { WebAuthnConfig } from './webauthn/config';
import type { WebhooksConfig } from './webhooks/config';

export type AuthIntent = 'login' | 'link_identity' | 'link_connector';

export type OAuth2ProviderClientConfiguration<Provider extends ProviderOption> =
	{
		credentials: CredentialsFor<Provider>;
		searchParams?: [string, string][];
	} & (ProvidersMap[Provider]['scopeRequired'] extends true
		? { scope: NonEmptyArray<string> }
		: { scope?: string[] });

export type OAuth2ProviderConfiguration<Provider extends ProviderOption> =
	| OAuth2ProviderClientConfiguration<Provider>
	| Record<string, OAuth2ProviderClientConfiguration<Provider>>;

export type OAuth2ConfigurationOptions = {
	[Provider in ProviderOption]?: OAuth2ProviderConfiguration<Provider>;
};

export type UserSessionId = `${string}-${string}-${string}-${string}-${string}`;

/** Stamped on a session created via admin impersonation (`startImpersonation`). RFC 8693
 *  actor semantics: `actorId`/`actorEmail` are the admin acting as the user, `reason` is
 *  required and audited, `returnToSessionId` is the admin's own session to restore on exit.
 *  Surfaced by userStatus so your UI can show an "impersonating" banner. */
export type Impersonator = {
	actorEmail?: string;
	actorId: string;
	reason: string;
	returnToSessionId?: UserSessionId;
	startedAt: number;
};

export type SessionData<UserType> = {
	user: UserType;
	/** OAuth provider access token. Optional: credential / SSO sessions are not backed
	 *  by a provider token, so they omit it. Only the OAuth routes (profile, refresh,
	 *  revoke) read it, and they are all gated on an `auth_provider`. */
	accessToken?: string;
	refreshToken?: string;
	expiresAt: number;
	/** When the session was last established by an actual authentication (login, OAuth
	 *  callback, or MFA challenge — NOT a token refresh). Drives step-up `requireRecentAuth`. */
	authenticatedAt?: number;
	/** SAML SP-initiated Single Logout context, captured at the SAML ACS. Lets
	 *  `{ssoRoute}/saml/:org/logout` build a signed LogoutRequest (the IdP needs the original
	 *  NameID + SessionIndex) for the connection the session was created from. */
	samlLogout?: {
		connectionId: string;
		nameId: string;
		sessionIndex?: string;
	};
	/** Present only when this session was created via admin impersonation. */
	impersonator?: Impersonator;
	/** True for a guest/anonymous session (createAnonymousSession) that can later be
	 *  upgraded by a real login. */
	anonymous?: boolean;
};

export type SessionRecord<UserType> = Record<
	UserSessionId,
	SessionData<UserType>
>;

export type UnregisteredSessionData = {
	userIdentity?: Record<string, unknown>;
	sessionInformation?: Record<string, unknown>;
	expiresAt: number;
	accessToken?: string;
	refreshToken?: string;
};

export type UnregisteredSessionRecord = Record<
	UserSessionId,
	UnregisteredSessionData
>;

export type ResolvedOAuthAuthorization = {
	userIdentity: Record<string, unknown>;
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	tokenType?: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TODO: Add better typing for the Elysia codes
export type StatusReturn = ElysiaCustomStatusResponse<any, any, any>;

export type OnNewUser<UserType> = (
	userIdentity: Record<string, unknown>
) =>
	| UserType
	| StatusReturn
	| Response
	| Promise<UserType | StatusReturn | Response>;

export type GetUser<UserType> = (
	userIdentity: Record<string, unknown>
) => UserType | null | undefined | Promise<UserType | null | undefined>;

export type CallbackCookie = Record<string, Cookie<unknown>> & {
	auth_client: Cookie<string | undefined>;
	auth_intent: Cookie<AuthIntent | undefined>;
	user_session_id: Cookie<UserSessionId | undefined>;
};

export type CallbackContext<UserType> = {
	providerInstance: OAuth2Client<ProviderOption>;
	authProvider: ProviderOption;
	authClient?: string;
	authIntent: AuthIntent;
	tokenResponse: OAuth2TokenResponse;
	session: SessionRecord<UserType>;
	unregisteredSession: UnregisteredSessionRecord;
	userSessionId: UserSessionId;
	originUrl: string;
	cookie: CallbackCookie;
	currentUser?: UserType;
	status: typeof statusType;
	redirect: typeof redirectType;
};

export type ResolveAuthIntent<UserType> =
	| (({
			authProvider,
			authClient,
			originUrl,
			session,
			userSessionId,
			currentUser
	  }: {
			authProvider: ProviderOption;
			authClient?: string;
			originUrl: string;
			session: SessionRecord<UserType>;
			userSessionId?: UserSessionId;
			currentUser?: UserType;
	  }) => AuthIntent | Promise<AuthIntent>)
	| undefined;

export type OnCallbackSuccess<UserType> =
	| ((
			context: CallbackContext<UserType>
	  ) =>
			| void
			| Response
			| StatusReturn
			| Promise<void | Response | StatusReturn>)
	| undefined;

export type OnLinkIdentity<UserType> =
	| ((
			context: CallbackContext<UserType>
	  ) =>
			| void
			| Response
			| StatusReturn
			| Promise<void | Response | StatusReturn>)
	| undefined;

export type OnLinkIdentityConflict<UserType> =
	| ((
			context: CallbackContext<UserType> & {
				conflict: AuthIdentityConflict;
			}
	  ) =>
			| void
			| Response
			| StatusReturn
			| Promise<void | Response | StatusReturn>)
	| undefined;

export type OnLinkConnector<UserType> =
	| ((
			context: CallbackContext<UserType>
	  ) =>
			| void
			| Response
			| StatusReturn
			| Promise<void | Response | StatusReturn>)
	| undefined;

export type OnCallbackError =
	| (({
			error,
			authProvider,
			originUrl
	  }: {
			authProvider: string;
			authClient?: string;
			error: unknown;
			originUrl: string;
	  }) => void | Promise<void>)
	| undefined;

export type OnAuthorizeSuccess =
	| (({
			authProvider,
			authClient,
			authIntent,
			authorizationUrl
	  }: {
			authProvider: string;
			authClient?: string;
			authIntent?: AuthIntent;
			authorizationUrl: URL;
	  }) => void | Promise<void>)
	| undefined;

export type OnAuthorizeError =
	| (({
			error,
			authProvider
	  }: {
			authProvider: string;
			authClient?: string;
			error: unknown;
	  }) => void | Promise<void>)
	| undefined;

export type OnRefreshSuccess =
	| (({
			tokenResponse,
			authProvider
	  }: {
			tokenResponse: OAuth2TokenResponse;
			authProvider: string;
			authClient?: string;
	  }) => void | Promise<void>)
	| undefined;

export type OnRefreshError =
	| (({
			error,
			authProvider
	  }: {
			authProvider: string;
			authClient?: string;
			error: unknown;
	  }) => void | Promise<void>)
	| undefined;

export type OnProfileSuccess =
	| (({
			userProfile,
			authProvider
	  }: {
			userProfile: Record<string, unknown>;
			authProvider: string;
			authClient?: string;
	  }) => void | Promise<void>)
	| undefined;

export type OnProfileError =
	| (({
			error,
			authProvider
	  }: {
			authProvider: string;
			authClient?: string;
			error: unknown;
	  }) => void | Promise<void>)
	| undefined;

export type OnRevocationSuccess =
	| (({
			tokenToRevoke,
			authProvider
	  }: {
			tokenToRevoke: string;
			authProvider: string;
			authClient?: string;
	  }) => void | Promise<void>)
	| undefined;

export type OnRevocationError =
	| (({
			error,
			authProvider
	  }: {
			authProvider: string;
			authClient?: string;
			error: unknown;
	  }) => void | Promise<void>)
	| undefined;

export type OnStatus<UserType> =
	| (({ user }: { user: UserType | null }) => void | Promise<void>)
	| undefined;

export type OnSignOut<UserType> =
	| (({
			authProvider,
			userSessionId,
			session
	  }: {
			/** Set only when the session was minted by the OAuth2 `/authorize` flow —
			 *  credentials, MFA, passwordless, SSO, WebAuthn, and impersonation-minted
			 *  sessions sign out without one. Use it to revoke the upstream provider
			 *  token when present; ignore when undefined. */
			authProvider: string | undefined;
			userSessionId: UserSessionId;
			session: SessionRecord<UserType>;
	  }) => void | Promise<void>)
	| undefined;

export type OnSessionCleanup<UserType> =
	| (({
			removedSessions,
			removedUnregisteredSessions
	  }: {
			removedSessions: Map<UserSessionId, SessionData<UserType>>;
			removedUnregisteredSessions: Map<
				UserSessionId,
				UnregisteredSessionData
			>;
	  }) => void | Promise<void>)
	| undefined;

export type RouteString = `/${string}`;
export type AuthorizeRoute = `${string}/:provider${'' | `/${string}`}`;

export type AuthConfig<UserType> = {
	providersConfiguration: OAuth2ConfigurationOptions;
	/** Override the `Secure` attribute on every cookie the package sets (session, OAuth state,
	 *  code_verifier, SSO nonce, ring, etc.). When omitted, defaults to
	 *  `process.env.NODE_ENV === 'production'` — matching the convention used by
	 *  express-session / iron-session / lucia / better-auth, and the only way non-browser
	 *  HTTP clients (curl, SSR fetch, test runners) can round-trip cookies on a plain-HTTP
	 *  dev server. If you run prod without setting `NODE_ENV=production`, set
	 *  `cookieSecure: true` explicitly. */
	cookieSecure?: boolean;
	authorizeRoute?: AuthorizeRoute;
	profileRoute?: RouteString;
	callbackRoute?: RouteString;
	refreshRoute?: RouteString;
	revokeRoute?: RouteString;
	signoutRoute?: RouteString;
	statusRoute?: RouteString;
	cleanupIntervalMs?: number;
	maxSessions?: number;
	sessionDurationMs?: number;
	authSessionStore?: AuthSessionStore<UserType>;
	/** Append-only audit logging. When present, `auth()` emits structured events
	 *  (register, login, mfa_*, password_reset, logout, …) from every flow into the
	 *  `auditStore` and/or `onAuditEvent` hook. SOC 2 prerequisite. */
	audit?: AuditConfig<UserType>;
	/** Local email/password (credentials) block. Additive and optional — when present,
	 *  mounts register / verify-email / login / reset-password routes that produce the
	 *  same `SessionData<UserType>` as OAuth, transparent to `protectRoute`. */
	credentials?: CredentialsConfig<UserType>;
	/** Passwordless login: magic links + email/SMS OTP. When present, mounts the magic-link flow
	 *  (if `onSendMagicLink` is set) and/or the OTP flow (if `onSendOtp` is set) under
	 *  `{passwordlessRoute}`; each verify route resolves the email to a user and mints the same
	 *  `SessionData<UserType>` as every other flow. */
	passwordless?: PasswordlessConfig<UserType>;
	/** Multi-factor auth (TOTP + backup codes). When present alongside `credentials`,
	 *  `auth()` auto-wires the login MFA gate, mounts the enroll/challenge routes, and
	 *  promotes the parked session once a factor is verified. */
	mfa?: MfaConfig<UserType>;
	/** Per-identity attempt throttling + account lockout on the credential login route
	 *  (progressive: locks after `maxAttempts` failures within `windowMs`). */
	lockout?: LockoutConfig;
	/** Self-service session management: `GET /auth/sessions` (list the caller's active
	 *  sessions) and `DELETE /auth/sessions/:id` (remote revoke). Requires an
	 *  `authSessionStore` that can enumerate sessions. */
	sessions?: SessionsConfig<UserType>;
	/** Per-organization enterprise SSO (the WorkOS-style model). When present, mounts
	 *  `GET {ssoRoute}/oidc/:organizationId/authorize` + `.../callback`, resolves the org's
	 *  OIDC connection from `ssoConnectionStore`, verifies the id_token in-house against the
	 *  issuer's JWKS, and mints the same `SessionData<UserType>` as every other flow. */
	sso?: SSOConfig<UserType>;
	/** SCIM 2.0 auto-provisioning for enterprise directory sync (Okta / Azure AD). When present,
	 *  mounts `{scimRoute}/Users` (+ `/ServiceProviderConfig`) with per-org bearer-token auth via
	 *  `scimTokenStore`, and maps SCIM resources to the consumer's user store through hooks. */
	scim?: ScimConfig;
	/** Machine-to-machine authentication: static API keys (`sk_…`) + the OAuth2
	 *  client_credentials grant. When `apiClientStore` + `accessTokenStore` are set,
	 *  mounts `{tokenRoute}` (defaults `/oauth2/token`) so registered clients can
	 *  exchange `client_id`/`client_secret` for short-lived `at_…` access tokens.
	 *  Pair with the exported `createApiKey` / `resolveApiPrincipal` / `hasScopes`
	 *  helpers to issue and guard with static keys. */
	apikeys?: ApiKeysConfig;
	/** OAuth2 / OIDC provider — makes your app an identity provider ("Sign in with
	 *  <yourapp>"). Mounts `{oidcRoute}/authorize` + `/token` + `/jwks` and
	 *  `/.well-known/openid-configuration`: authorization_code + mandatory PKCE, ES256
	 *  JWTs signed by a key you own (self-hosted JWKS), refresh-token rotation, and
	 *  optional DPoP (RFC 9449) sender-constrained tokens. The authorize endpoint reuses
	 *  the package session, so the IdP login gets passkeys / MFA / SSO for free. */
	oidc?: OidcProviderConfig<UserType>;
	/** First-class multi-tenancy (the WorkOS model). When present, mounts organization +
	 *  membership + invitation routes under `{organizationsRoute}`: list the caller's orgs, create
	 *  one (caller becomes owner), invite/accept/revoke by email, and list/remove members. Ties the
	 *  bare `organizationId` used by SSO/SCIM/RBAC into a real tenant model with org-scoped roles. */
	organizations?: OrganizationsConfig<UserType>;
	/** Admin portal — the WorkOS self-serve "setup link" model, headless. When present, mounts
	 *  `{portalRoute}` endpoints a customer's IT admin (holding a scoped setup token from
	 *  `createSetupSession`) calls to read the service-provider URLs and configure their own SSO
	 *  connection / SCIM token. JSON contract, so the portal UI can be built in any framework. */
	portal?: PortalConfig;
	/** Org-scoped roles & permissions (builds on `organizations`). When present, mounts routes to
	 *  list an org's role definitions and set a member's roles. Pair with
	 *  `createMembershipPermissionResolver` to make `authorization.hasPermission` turnkey. */
	roles?: RolesConfig<UserType>;
	/** Role-based / attribute-based access control (E4). When present, `auth()` exposes a
	 *  `protectPermission(check, handler)` derive (alongside `protectRoute`) that delegates the
	 *  decision to your `hasPermission` hook — the package stays schema-agnostic about roles. */
	authorization?: AuthorizationConfig<UserType>;
	/** GDPR/CCPA self-service compliance (E5). When present, mounts `GET {complianceRoute}/export`
	 *  (right to access) and `DELETE {complianceRoute}` (right to erasure — runs your delete hook,
	 *  revokes the user's sessions, clears the cookie). Pair with `audit.redact` for PII redaction. */
	compliance?: ComplianceConfig<UserType>;
	/** Passwordless / passkey auth (WebAuthn). When present, mounts the registration ceremony
	 *  (`{webauthnRoute}/register/options` + `/verify`, adds a passkey to the authenticated caller)
	 *  and the authentication ceremony (`.../authenticate/options` + `/verify`, passwordless sign-in
	 *  → mints the same `SessionData<UserType>`). A `webauthnAdapter` wraps a vetted library (e.g.
	 *  `@simplewebauthn/server`); the package never bundles the WebAuthn crypto. */
	webauthn?: WebAuthnConfig<UserType>;
	/** Signed outbound webhooks. When present, every emitted auth event (the audit taxonomy) is
	 *  HMAC-signed (Standard Webhooks scheme) and POSTed to each endpoint. Delivery is best-effort
	 *  and isolated per endpoint; configuring this alone (without `audit`) is enough to turn on
	 *  event emission. PII redaction (`audit.redact`) applies before delivery. */
	webhooks?: WebhooksConfig;
	/** Enable the built-in HTMX fragment routes (login, identities, connectors,
	 *  account, signout, delete-account). Supply provider display data + the
	 *  identity/connector data actions; the package owns the route wiring and
	 *  renderers. See @absolutejs/auth/ui to override individual fragments.
	 *
	 *  Only available when `UserType` has the fields the fragments render
	 *  (`sub` + optional email/name); users that don't enable HTMX are never
	 *  constrained. */
	htmx?: UserType extends AuthHtmxUser ? AuthHtmxConfig : never;
	unregisteredSessionDurationMs?: number;
	resolveAuthIntent?: ResolveAuthIntent<UserType>;
	onAuthorizeSuccess?: OnAuthorizeSuccess;
	onAuthorizeError?: OnAuthorizeError;
	onCallbackSuccess?: OnCallbackSuccess<UserType>;
	onLinkIdentity?: OnLinkIdentity<UserType>;
	onLinkIdentityConflict?: OnLinkIdentityConflict<UserType>;
	onLinkConnector?: OnLinkConnector<UserType>;
	onCallbackError?: OnCallbackError;
	onStatus?: OnStatus<UserType>;
	onRefreshSuccess?: OnRefreshSuccess;
	onRefreshError?: OnRefreshError;
	onSignOut?: OnSignOut<UserType>;
	onRevocationSuccess?: OnRevocationSuccess;
	onRevocationError?: OnRevocationError;
	onProfileSuccess?: OnProfileSuccess;
	onProfileError?: OnProfileError;
	onSessionCleanup?: OnSessionCleanup<UserType>;
};

/** The serializable subset of `AuthConfig` — the route paths, session durations, and
 *  limits that can live in a data file (`auth.config.ts` via `defineAuthSettings`) and
 *  be edited from tooling, separate from the code wiring (stores, hooks, callbacks)
 *  that stays in the `auth()` call. Spread alongside the rest:
 *  `auth({ ...defineAuthSettings({...}), authSessionStore, providersConfiguration })`. */
export type AuthSettings = Pick<
	AuthConfig<unknown>,
	| 'authorizeRoute'
	| 'callbackRoute'
	| 'cleanupIntervalMs'
	| 'maxSessions'
	| 'profileRoute'
	| 'refreshRoute'
	| 'revokeRoute'
	| 'sessionDurationMs'
	| 'signoutRoute'
	| 'statusRoute'
	| 'unregisteredSessionDurationMs'
>;

export type ClientProviderEntry = {
	clientName?: string;
	providerInstance: OAuth2Client<ProviderOption>;
	scope?: string[];
	searchParams?: [string, string][];
};

export type ClientProviderGroup = {
	entries: Record<string, ClientProviderEntry>;
	isSingleClient: boolean;
};

export type ClientProviders = Record<string, ClientProviderGroup>;

export type InsantiateUserSessionProps<UserType> = {
	authProvider: ProviderOption;
	tokenResponse: OAuth2TokenResponse;
	session: SessionRecord<UserType>;
	unregisteredSession: UnregisteredSessionRecord;
	providerInstance: OAuth2Client<ProviderOption>;
	user_session_id: Cookie<UserSessionId | undefined>;
	onNewUser: OnNewUser<UserType>;
	getUser: GetUser<UserType>;
	cookieSecure?: boolean;
	resolvedAuthorization?: ResolvedOAuthAuthorization;
	sessionDurationMs?: number;
	unregisteredSessionDurationMs?: number;
};
