import { Cookie } from 'elysia';
import { CredentialsFor, OAuth2Client, ProviderOption } from 'citra';

type SessionData<UserType> = {
	user: UserType;
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
	userProfile,
	session,
	user_session_id
}: {
	authProvider: string;
	userProfile: Record<string, unknown>;
	session: SessionRecord<UserType>;
	user_session_id: Cookie<string | undefined>;
}) => void | Promise<void>;

export type AbsoluteAuthProps<UserType> = {
	config: Oauth2ConfigOptions;
	authorizeRoute?: `${string}/:provider${'' | `/${string}`}`;
	callbackRoute?: string;
	refreshRoute?: string;
	revokeRoute?: string;
	logoutRoute?: string;
	statusRoute?: string;
	onAuthorize?: () => void;
	onCallback?: OnCallback<UserType>;
	onStatus?: () => void;
	onRefresh?: () => void;
	onLogout?: () => void;
	onRevoke?: () => void;
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
	session: SessionRecord<UserType>;
	user_session_id: Cookie<string | undefined>;
	createUser: () => UserType | Promise<UserType>;
	getUser: () => UserType | Promise<UserType | null>;
};
