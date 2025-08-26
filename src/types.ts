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

export type UserSessionId = `${string}-${string}-${string}-${string}-${string}`;

export type SessionRecord<UserType> = Record<
	UserSessionId,
	SessionData<UserType>
>;

export type UnregisteredSessionRecord = Record<
	UserSessionId,
	{
		userIdentity: Record<string, unknown>;
		expiresAt: number;
		accessToken: string;
		refreshToken?: string;
	}
>;

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

export type CallbackCookie = Record<string, Cookie<string | undefined>> & {
	user_session_id: Cookie<UserSessionId | undefined>;
};

export type OnCallbackSuccess<UserType> =
	| (({
			authProvider,
			tokenResponse,
			providerInstance,
			session,
			userSessionId,
			originUrl,
			cookie,
			redirect,
			status
	  }: {
			providerInstance: OAuth2Client<ProviderOption>;
			authProvider: string;
			tokenResponse: OAuth2TokenResponse;
			session: SessionRecord<UserType>;
			unregisteredSession: UnregisteredSessionRecord;
			userSessionId: UserSessionId;
			originUrl: string;
			cookie: CallbackCookie;
			status: typeof statusType; // TODO There is no valid return type for returning status although it is a valid return, Elysia status is hard to get the return type inferred correctly
			redirect: typeof redirectType;
	  }) =>
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
			userSessionId: UserSessionId;
			session: SessionRecord<UserType>;
	  }) => void | Promise<void>)
	| undefined;

export type RouteString = `/${string}`;
export type AuthorizeRoute = `${string}/:provider${'' | `/${string}`}`;

export type GetStatusProps<UserType> = {
	user_session_id: Cookie<UserSessionId | undefined>;
	session: SessionRecord<UserType>;
};

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
	unregisteredSession: UnregisteredSessionRecord;
	providerInstance: OAuth2Client<ProviderOption>;
	user_session_id: Cookie<UserSessionId | undefined>;
	onNewUser: OnNewUser<UserType>;
	getUser: GetUser<UserType>;
};
