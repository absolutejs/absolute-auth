import { defineProvider } from 'citra';
import type { CustomProviderClientConfiguration } from '../types';

/** Neon requires a registered partner OAuth application. */
export const neonProviderConfiguration = defineProvider({
	authorizationUrl: 'https://oauth2.neon.tech/oauth2/auth',
	isOIDC: true,
	isRefreshable: true,
	PKCEMethod: 'S256',
	profileRequest: {
		authIn: 'header',
		encoding: 'application/json',
		method: 'GET',
		url: 'https://oauth2.neon.tech/userinfo'
	},
	revocationRequest: {
		authIn: 'body',
		encoding: 'application/x-www-form-urlencoded',
		tokenParamName: 'token',
		url: 'https://oauth2.neon.tech/oauth2/revoke'
	},
	scopeRequired: true,
	subject: ['sub'],
	subjectType: 'string',
	tokenRequest: {
		authIn: 'body',
		encoding: 'application/x-www-form-urlencoded',
		url: 'https://oauth2.neon.tech/oauth2/token'
	}
});

export type NeonManagementScope = `urn:neoncloud:${'projects' | 'orgs'}:${
	| 'create'
	| 'read'
	| 'update'
	| 'delete'
	| 'permission'}`;

export type NeonProviderOptions = {
	credentials: {
		clientId: string;
		clientSecret: string;
		redirectUri: string;
	};
	/** Select permissions deliberately; no management permissions are implicit. */
	scopes: readonly NeonManagementScope[];
	/** Request both scopes required by Neon to issue a refresh token. */
	offlineAccess?: boolean;
};

/** Configure `customProviders.neon` without granting management permissions implicitly. */
export const createNeonProviderConfiguration = ({
	credentials,
	offlineAccess = false,
	scopes
}: NeonProviderOptions): CustomProviderClientConfiguration => ({
	credentials: { ...credentials },
	providerConfig: neonProviderConfiguration,
	scope: [
		'openid',
		...(offlineAccess ? ['offline', 'offline_access'] : []),
		...new Set(scopes)
	]
});
