import {
	CredentialsFor,
	OAuth2Client,
	OAuth2TokenResponse,
	ProviderOption
} from 'citra';
import { Cookie } from 'elysia';

type SessionData<UserType> = {
	user: UserType;
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
};

export type OAuth2ConfigurationOptions = {
	[Provider in ProviderOption]?: {
		credentials: CredentialsFor<Provider>;
		scope?: string[];
		searchParams?: [string, string][];
	};
};

export type SessionRecord<UserType> = Record<
	string,
	SessionData<UserType> | undefined
>;

export type UserFunctionProps = {
	authProvider: string;
	userProfile: Record<string, unknown>;
};

export type CreateUser<UserType> = ({
	userProfile,
	authProvider
}: UserFunctionProps) => Promise<UserType>;

export type GetUser<UserType> = ({
	userProfile,
	authProvider
}: UserFunctionProps) => Promise<UserType | null>;

export type OnCallbackSuccess<UserType> = ({
	authProvider,
	tokenResponse,
	providerInstance,
	session,
	user_session_id,
	originUrl
}: {
	providerInstance: OAuth2Client<ProviderOption>;
	authProvider: string;
	tokenResponse: OAuth2TokenResponse;
	session: SessionRecord<UserType>;
	user_session_id: Cookie<string | undefined>;
	originUrl: string;
}) => void | Promise<void>;

export type OnAuthorizeSuccess = ({
	authProvider,
	authorizationUrl
}: {
	authProvider: string;
	authorizationUrl: URL;
}) => void | Promise<void>;

export type OnRefreshSuccess = ({
	tokenResponse,
	authProvider
}: {
	tokenResponse: OAuth2TokenResponse;
	authProvider: string;
}) => void | Promise<void>;

export type OnProfileSuccess = ({
	userProfile,
	authProvider
}: {
	userProfile: Record<string, unknown>;
	authProvider: string;
}) => void | Promise<void>;

export type OnRevocationSuccess = ({
	tokenToRevoke,
	authProvider
}: {
	tokenToRevoke: string;
	authProvider: string;
}) => void | Promise<void>;

export type OnStatus<UserType> = ({
	user
}: {
	user: UserType | null;
}) => void | Promise<void>;

export type OnSignOut<UserType> = ({
	authProvider,
	userSession
}: {
	authProvider: string;
	userSession: SessionData<UserType>;
}) => void | Promise<void>;

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
	onCallbackSuccess?: OnCallbackSuccess<UserType>;
	onStatus?: OnStatus<UserType>;
	onRefreshSuccess?: OnRefreshSuccess;
	onSignOut?: OnSignOut<UserType>;
	onRevocationSuccess?: OnRevocationSuccess;
	onProfileSuccess?: OnProfileSuccess;
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
	user_session_id: Cookie<string | undefined>;
	createUser: (
		userProfile: Record<string, unknown>
	) => UserType | Promise<UserType>;
	getUser: (
		userProfile: Record<string, unknown>
	) => UserType | null | undefined | Promise<UserType | null | undefined>;
};
