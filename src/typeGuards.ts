import { OAuth2Tokens } from 'arctic';
import { providers } from './providers';
import { Providers } from './types';

export const isRefreshableProvider = (
	provider: InstanceType<(typeof providers)[Providers]>
): provider is InstanceType<(typeof providers)[Providers]> & {
	refreshAccessToken: () => Promise<OAuth2Tokens>;
} =>
	'refreshAccessToken' in provider &&
	typeof provider.refreshAccessToken === 'function';

export const isRevocableProvider = (
	provider: InstanceType<(typeof providers)[Providers]>
): provider is InstanceType<(typeof providers)[Providers]> & {
	revokeAccessToken: (token: string) => Promise<void>;
} =>
	'revokeAccessToken' in provider &&
	typeof provider.revokeAccessToken === 'function';

export const isValidProviderKey = (
	provider: string
): provider is keyof typeof providers =>
	Object.keys(providers)
		.map((key) => key.toLowerCase())
		.includes(provider.toLowerCase());

export const isValidUser = <UserType>(user: unknown): user is UserType => true;

export const isNonEmptyString = (
	str: string | null | undefined
): str is string => str !== null && str !== undefined && str.trim() !== '';
