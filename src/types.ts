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

type Oauth2ConfigOptions = {
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

export type OnCallback<UserType> = ({
	authProvider,
	tokenResponse,
	userProfile,
	session,
	user_session_id
}: {
	authProvider: string;
	tokenResponse: OAuth2TokenResponse;
	userProfile: Record<string, unknown>;
	session: SessionRecord<UserType>;
	user_session_id: Cookie<string | undefined>;
}) => void | Promise<void>;

export type OnAuthorize = ({
	authProvider,
	authorizationUrl
}: {
	authProvider: string;
	authorizationUrl: URL;
}) => void | Promise<void>;

export type OnRefresh = ({
	tokenResponse,
	authProvider
}: {
	tokenResponse: OAuth2TokenResponse;
	authProvider: string;
}) => void | Promise<void>;

export type OnProfile = ({
	userProfile,
	authProvider
}: {
	userProfile: Record<string, unknown>;
	authProvider: string;
}) => void | Promise<void>;

export type OnRevocation = ({
	tokenToRevoke,
	authProvider
}: {
	tokenToRevoke: string;
	authProvider: string;
}) => void | Promise<void>;

export type OnStatus = <UserType>({
	authProvider,
	user
}: {
	authProvider: string;
	user: UserType | null;
}) => void | Promise<void>;
export type RouteString = `/${string}`;
export type AuthorizeRoute = `${string}/:provider${'' | `/${string}`}`;

export type AbsoluteAuthProps<UserType> = {
	config: Oauth2ConfigOptions;
	authorizeRoute?: AuthorizeRoute;
	profileRoute?: RouteString;
	callbackRoute?: RouteString;
	refreshRoute?: RouteString;
	revokeRoute?: RouteString;
	signoutRoute?: RouteString;
	statusRoute?: RouteString;
	onAuthorize?: OnAuthorize;
	onCallback?: OnCallback<UserType>;
	onStatus?: () => void;
	onRefresh?: OnRefresh;
	onSignOut?: () => void;
	onRevocation?: OnRevocation;
	onProfile?: OnProfile;
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
	userProfile: Record<string, unknown>;
	tokenResponse: OAuth2TokenResponse;
	session: SessionRecord<UserType>;
	user_session_id: Cookie<string | undefined>;
	createUser: () => UserType | Promise<UserType>;
	getUser: () => UserType | Promise<UserType | null>;
};
