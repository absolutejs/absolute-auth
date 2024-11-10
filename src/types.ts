import { providers } from './providers';

export type Providers = keyof typeof providers;

export type SessionData<UserType> = {
	user: UserType;
	expiresAt: number;
};

export type SessionRecord<UserType> = Record<
	string,
	SessionData<UserType> | undefined
>;

export type Oauth2ConfigOptions = {
	[K in Providers]?: {
		credentials: ConstructorParameters<(typeof providers)[K]>;
		scopes?: string[];
		searchParams?: [string, string][];
	};
};

export type OAuthEventHandler = () => void;

export type CreateUser<UserType> = ({
	decodedIdToken,
	authProvider
}: {
	decodedIdToken: {
		[key: string]: string | undefined;
	};
	authProvider: string;
}) => Promise<UserType>;

export type GetUser<UserType> = ({
	decodedIdToken,
	authProvider
}: {
	decodedIdToken: {
		[key: string]: string | undefined;
	};
	authProvider: string;
}) => Promise<UserType | null>;

export type AbsoluteAuthProps<ConfigOptions extends Oauth2ConfigOptions> = {
	config: ConfigOptions;
	authorizeRoute?: string;
	callbackRoute?: string;
	refreshRoute?: string;
	revokeRoute?: string;
	logoutRoute?: string;
	statusRoute?: string;
	onAuthorize?: OAuthEventHandler;
	onCallback?: OAuthEventHandler;
	onStatus?: OAuthEventHandler;
	onRefresh?: OAuthEventHandler;
	onLogout?: OAuthEventHandler;
	onRevoke?: OAuthEventHandler;
	createUser?: CreateUser<any>;
	getUser?: GetUser<any>;
};

export type ClientProviders = Record<
	string,
	{
		providerInstance: InstanceType<(typeof providers)[Providers]>;
		scopes: string[];
		searchParams: [string, string][];
		userInfoURL?: URL;
	}
>;
