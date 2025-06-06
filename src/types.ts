import {
	CredentialsFor,
	NonEmptyArray,
	OAuth2Client,
	OAuth2TokenResponse,
	ProviderOption,
	ProvidersMap
} from 'citra';

type SessionData<UserType> = {
	user: UserType;
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
};

export type OAuth2ConfigurationOptions = {
	[Provider in ProviderOption]?: {
		credentials: CredentialsFor<Provider>;
		searchParams?: [string, string][];
	} & (ProvidersMap[Provider]['scopeRequired'] extends true
		? { scope: NonEmptyArray<string> }
		: { scope?: string[] });
};

export type SessionRecord<UserType> = Record<
	string,
	SessionData<UserType> | undefined
>;

export type CreateUser<UserType> = (
	userIdentity: Record<string, unknown>
) => UserType | Promise<UserType>;

export type GetUser<UserType> = (
	userIdentity: Record<string, unknown>
) => UserType | null | undefined | Promise<UserType | null | undefined>;

export type OnCallbackSuccess<UserType> =
	| (({
			authProvider,
			tokenResponse,
			providerInstance,
			session,
			userSessionId,
			originUrl
	  }: {
			providerInstance: OAuth2Client<ProviderOption>;
			authProvider: string;
			tokenResponse: OAuth2TokenResponse;
			session: SessionRecord<UserType>;
			userSessionId: `${string}-${string}-${string}-${string}-${string}`;
			originUrl: string;
	  }) => void | Promise<void>)
	| undefined;

export type OnCallbackError =
	| (({
			error,
			authProvider,
			originUrl
	  }: {
			authProvider: string;
			error: unknown;
			originUrl: string;
	  }) => void | Promise<void>)
	| undefined;

export type OnAuthorizeSuccess =
	| (({
			authProvider,
			authorizationUrl
	  }: {
			authProvider: string;
			authorizationUrl: URL;
	  }) => void | Promise<void>)
	| undefined;

export type OnAuthorizeError =
	| (({
			error,
			authProvider
	  }: {
			authProvider: string;
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
	  }) => void | Promise<void>)
	| undefined;

export type OnRefreshError =
	| (({
			error,
			authProvider
	  }: {
			authProvider: string;
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
	  }) => void | Promise<void>)
	| undefined;

export type OnProfileError =
	| (({
			error,
			authProvider
	  }: {
			authProvider: string;
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
	  }) => void | Promise<void>)
	| undefined;

export type OnRevocationError =
	| (({
			error,
			authProvider
	  }: {
			authProvider: string;
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
			userSessionId: `${string}-${string}-${string}-${string}-${string}`;
			session: SessionRecord<UserType>;
	  }) => void | Promise<void>)
	| undefined;

export type RouteString = `/${string}`;
export type AuthorizeRoute = `${string}/:provider${'' | `/${string}`}`;

export type AbsoluteAuthProps<UserType> = {
	providersConfiguration: OAuth2ConfigurationOptions;
	authorizeRoute?: AuthorizeRoute;
	profileRoute?: RouteString;
	callbackRoute?: RouteString;
	refreshRoute?: RouteString;
	revokeRoute?: RouteString;
	signoutRoute?: RouteString;
	statusRoute?: RouteString;
	onAuthorizeSuccess?: OnAuthorizeSuccess;
	onAuthorizeError?: OnAuthorizeError;
	onCallbackSuccess?: OnCallbackSuccess<UserType>;
	onCallbackError?: OnCallbackError;
	onStatus?: OnStatus<UserType>;
	onRefreshSuccess?: OnRefreshSuccess;
	onRefreshError?: OnRefreshError;
	onSignOut?: OnSignOut<UserType>;
	onRevocationSuccess?: OnRevocationSuccess;
	onRevocationError?: OnRevocationError;
	onProfileSuccess?: OnProfileSuccess;
	onProfileError?: OnProfileError;
};

export type ClientProviders = Record<
	string,
	{
		providerInstance: OAuth2Client<ProviderOption>;
		scope?: string[];
		searchParams?: [string, string][];
	}
>;

export type InsantiateUserSessionProps<UserType> = {
	authProvider: string;
	tokenResponse: OAuth2TokenResponse;
	session: SessionRecord<UserType>;
	providerInstance: OAuth2Client<ProviderOption>;
	userSessionId: `${string}-${string}-${string}-${string}-${string}`;
	createUser: CreateUser<UserType>;
	getUser: GetUser<UserType>;
};
