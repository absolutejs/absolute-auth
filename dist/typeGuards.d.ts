import { OAuth2Tokens } from 'arctic';
import { providers, userInfoURLs, issuerURLs } from './providers';
import { Providers } from './types';
export declare const isRefreshableProvider: (provider: InstanceType<(typeof providers)[Providers]>) => provider is InstanceType<(typeof providers)[Providers]> & {
    refreshAccessToken: () => Promise<OAuth2Tokens>;
};
export declare const isRevocableProvider: (provider: InstanceType<(typeof providers)[Providers]>) => provider is InstanceType<(typeof providers)[Providers]> & {
    revokeAccessToken: (token: string) => Promise<void>;
};
export declare const isValidProviderKey: (provider: string) => provider is keyof typeof providers;
export declare const isValidUserInfoURLKey: (userInfoURLKey: string) => userInfoURLKey is keyof typeof userInfoURLs;
export declare const isValidIssuerURLKey: (issuerURLKey: string) => issuerURLKey is keyof typeof issuerURLs;
export declare const isValidUser: <UserType>(user: any) => user is UserType;
