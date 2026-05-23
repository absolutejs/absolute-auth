import {
	createOAuth2Client,
	isRefreshableOAuth2Client,
	isValidProviderOption
} from 'citra';
import type {
	LinkedProviderBindingStore,
	LinkedProviderGrantStore
} from '@absolutejs/linked-providers';
import { createLinkedProviderCredentialResolver } from './linkedProviderResolver';
import { resolveProviderClientConfiguration } from './providerClients';
import type { OAuth2ConfigurationOptions } from './types';

export type CreateOAuthLinkedProviderCredentialResolverOptions = {
	grantStore: LinkedProviderGrantStore;
	bindingStore: LinkedProviderBindingStore;
	providersConfiguration: OAuth2ConfigurationOptions;
	now?: () => number;
};

const getGrantedScopes = (scopeValue: unknown, fallbackScopes: string[]) => {
	if (typeof scopeValue === 'string' && scopeValue.trim().length > 0) {
		return [...new Set(scopeValue.split(/\s+/).filter(Boolean))];
	}

	return [...new Set(fallbackScopes.filter(Boolean))];
};

const getExpiresAt = (tokenResponse: Record<string, unknown>) => {
	const expiresIn = tokenResponse.expires_in;
	const expiresInSeconds =
		typeof expiresIn === 'number'
			? expiresIn
			: typeof expiresIn === 'string' && expiresIn.trim().length > 0
				? Number(expiresIn)
				: Number.NaN;

	if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
		return undefined;
	}

	return Date.now() + expiresInSeconds * 1000;
};

export const createOAuthLinkedProviderCredentialResolver = async ({
	bindingStore,
	grantStore,
	now,
	providersConfiguration
}: CreateOAuthLinkedProviderCredentialResolverOptions) => {
	const clientEntries: Array<
		Promise<[string, Awaited<ReturnType<typeof createOAuth2Client>>]>
	> = [];

	for (const [providerName, providerConfig] of Object.entries(
		providersConfiguration
	)) {
		if (!isValidProviderOption(providerName)) {
			continue;
		}

		const resolvedProviderClientConfiguration =
			resolveProviderClientConfiguration({
				providerName,
				providersConfiguration
			});
		if (
			'error' in resolvedProviderClientConfiguration ||
			!resolvedProviderClientConfiguration.config
		) {
			continue;
		}

		clientEntries.push(
			createOAuth2Client(
				providerName,
				resolvedProviderClientConfiguration.config.credentials
			).then(
				(providerInstance) => [providerName, providerInstance] as const
			)
		);
	}

	const clients = new Map(await Promise.all(clientEntries));

	return createLinkedProviderCredentialResolver({
		bindingStore,
		grantStore,
		now,
		loadAccessTokenLease: async (grant) =>
			grant.accessTokenCiphertext
				? {
						accessToken: grant.accessTokenCiphertext,
						expiresAt: grant.expiresAt,
						grantedScopes: grant.grantedScopes,
						tokenType: grant.tokenType
					}
				: null,
		refreshAccessTokenLease: async (grant) => {
			if (
				!isValidProviderOption(grant.authProviderKey) ||
				!grant.refreshTokenCiphertext
			) {
				return null;
			}

			const providerKey = grant.authProviderKey;
			const providerClientName =
				typeof grant.metadata?.providerClient === 'string' &&
				grant.metadata.providerClient.trim().length > 0
					? grant.metadata.providerClient.trim()
					: undefined;
			const resolvedProviderClientConfiguration =
				resolveProviderClientConfiguration({
					clientName: providerClientName,
					providerName: providerKey,
					providersConfiguration
				});
			if (
				'error' in resolvedProviderClientConfiguration ||
				!resolvedProviderClientConfiguration.config
			) {
				return null;
			}
			const providerClient = await createOAuth2Client(
				providerKey,
				resolvedProviderClientConfiguration.config.credentials
			);
			if (
				!providerClient ||
				!isRefreshableOAuth2Client(providerKey, providerClient)
			) {
				return null;
			}

			const tokenResponse = await providerClient.refreshAccessToken(
				grant.refreshTokenCiphertext
			);
			const refreshedAt = Date.now();
			const grantedScopes = getGrantedScopes(
				Reflect.get(tokenResponse as object, 'scope'),
				grant.grantedScopes
			);
			const tokenType = Reflect.get(
				tokenResponse as object,
				'token_type'
			);
			const refreshedGrant = {
				...grant,
				accessTokenCiphertext: tokenResponse.access_token,
				expiresAt: getExpiresAt(
					tokenResponse as Record<string, unknown>
				),
				grantedScopes,
				lastRefreshError: undefined,
				lastRefreshedAt: refreshedAt,
				refreshTokenCiphertext:
					tokenResponse.refresh_token ?? grant.refreshTokenCiphertext,
				status: 'active' as const,
				tokenType:
					typeof tokenType === 'string' ? tokenType : grant.tokenType,
				updatedAt: refreshedAt
			};

			return {
				grant: refreshedGrant,
				lease: {
					accessToken: refreshedGrant.accessTokenCiphertext ?? '',
					expiresAt: refreshedGrant.expiresAt,
					grantedScopes: refreshedGrant.grantedScopes,
					tokenType: refreshedGrant.tokenType
				}
			};
		}
	});
};
