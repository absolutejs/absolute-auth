import { OAuth2Tokens } from 'arctic';
import { providers, userInfoURLs, issuerURLs } from './providers';
import type { Providers } from './types';

export const isRefreshableProvider = (
	provider: InstanceType<(typeof providers)[Providers]>
): provider is InstanceType<(typeof providers)[Providers]> & {
	refreshAccessToken: () => Promise<OAuth2Tokens>;
} => {
	return (
		'refreshAccessToken' in provider &&
		typeof provider.refreshAccessToken === 'function'
	);
};

export const isRevocableProvider = (
	provider: InstanceType<(typeof providers)[Providers]>
): provider is InstanceType<(typeof providers)[Providers]> & {
	revokeAccessToken: (token: string) => Promise<void>;
} => {
	return (
		'revokeAccessToken' in provider &&
		typeof provider.revokeAccessToken === 'function'
	);
};

export const isValidProviderKey = (
	provider: string
): provider is keyof typeof providers => {
	return Object.keys(providers)
		.map((key) => key.toLowerCase())
		.includes(provider.toLowerCase());
};

export const isValidUserInfoURLKey = (
	userInfoURLKey: string
): userInfoURLKey is keyof typeof userInfoURLs => {
	return Object.keys(userInfoURLs).includes(userInfoURLKey);
};

export const isValidIssuerURLKey = (
	issuerURLKey: string
): issuerURLKey is keyof typeof issuerURLs => {
	return Object.keys(issuerURLs).includes(issuerURLKey);
};

export const isValidUser = <UserType>(user: any): user is UserType => {
	return true;
};
