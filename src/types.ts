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
import type { AuthIdentityConflict } from './errors';
import type { AuthHtmxConfig, AuthHtmxUser } from './htmx/types';
import type { AuthSessionStore } from './session/types';

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

export type SessionData<UserType> = {
	user: UserType;
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
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
			authProvider: string;
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
	resolvedAuthorization?: ResolvedOAuthAuthorization;
	sessionDurationMs?: number;
	unregisteredSessionDurationMs?: number;
};
