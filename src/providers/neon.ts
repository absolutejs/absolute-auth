import { providers } from 'citra';
import type { OAuth2ProviderClientConfiguration } from '../types';

/** Canonical Citra definition for the registered Neon partner application. */
export const neonProviderConfiguration = providers.neon;

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

/** Configure `providersConfiguration.neon` without granting management permissions implicitly. */
export const createNeonProviderConfiguration = ({
	credentials,
	offlineAccess = false,
	scopes
}: NeonProviderOptions): OAuth2ProviderClientConfiguration<'neon'> => ({
	credentials: { ...credentials },
	scope: [
		'openid',
		...(offlineAccess ? ['offline', 'offline_access'] : []),
		...new Set(scopes)
	]
});
