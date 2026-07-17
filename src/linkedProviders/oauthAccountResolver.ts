import type {
	LinkedProviderBinding,
	LinkedProviderBindingStore,
	LinkedProviderGrant,
	LinkedProviderGrantStore
} from '@absolutejs/linked-providers';
import type { OAuth2ConfigurationOptions } from '../types';
import { createOAuthLinkedProviderCredentialResolver } from './oauthResolver';

export type OAuthLinkedProviderAccount = {
	accessToken?: string;
	authProviderKey: string;
	createdAt: number;
	expiresAt?: number;
	grantedScopes: string[];
	id: string;
	metadata?: Record<string, unknown>;
	ownerRef: string;
	providerSubject: string;
	refreshToken?: string;
	status: LinkedProviderGrant['status'];
	tokenType?: string;
	updatedAt: number;
};

export type OAuthLinkedProviderAccountStore = {
	getAccount: (id: string) => Promise<OAuthLinkedProviderAccount | undefined>;
	listAccountsByOwner: (
		ownerRef: string
	) => Promise<OAuthLinkedProviderAccount[]>;
	saveAccount: (account: OAuthLinkedProviderAccount) => Promise<void>;
};

export type CreateOAuthAccountLinkedProviderCredentialResolverOptions = {
	accountStore: OAuthLinkedProviderAccountStore;
	providersConfiguration: OAuth2ConfigurationOptions;
	now?: () => number;
};

const bindingId = (accountId: string) => `oauth-account:${accountId}`;
const accountIdFromBinding = (id: string) => {
	const prefix = 'oauth-account:';

	return id.startsWith(prefix) ? id.slice(prefix.length) : null;
};

const toGrant = (account: OAuthLinkedProviderAccount): LinkedProviderGrant => ({
	accessTokenCiphertext: account.accessToken,
	authProviderKey: account.authProviderKey,
	createdAt: account.createdAt,
	expiresAt: account.expiresAt,
	grantedScopes: [...account.grantedScopes],
	id: account.id,
	metadata: account.metadata,
	ownerRef: account.ownerRef,
	providerFamily: account.authProviderKey,
	providerSubject: account.providerSubject,
	refreshTokenCiphertext: account.refreshToken,
	status: account.status,
	tokenType: account.tokenType,
	updatedAt: account.updatedAt
});

const toBinding = (
	account: OAuthLinkedProviderAccount
): LinkedProviderBinding => ({
	availableScopes: [...account.grantedScopes],
	connectorProvider: account.authProviderKey,
	createdAt: account.createdAt,
	externalAccountId: account.providerSubject,
	externalAccountType: 'user',
	grantId: account.id,
	id: bindingId(account.id),
	metadata: account.metadata,
	status:
		account.status === 'revoked' || account.status === 'error'
			? 'disconnected'
			: 'active',
	updatedAt: account.updatedAt
});

const accountWithGrant = (
	account: OAuthLinkedProviderAccount,
	grant: LinkedProviderGrant
): OAuthLinkedProviderAccount => ({
	...account,
	accessToken: grant.accessTokenCiphertext,
	authProviderKey: grant.authProviderKey,
	expiresAt: grant.expiresAt,
	grantedScopes: [...grant.grantedScopes],
	metadata: grant.metadata,
	ownerRef: grant.ownerRef,
	providerSubject: grant.providerSubject,
	refreshToken: grant.refreshTokenCiphertext,
	status: grant.status,
	tokenType: grant.tokenType,
	updatedAt: grant.updatedAt
});

const accountStatusForBinding = (
	account: OAuthLinkedProviderAccount,
	binding: LinkedProviderBinding
) => {
	if (binding.status === 'disconnected') return 'revoked';
	if (binding.status === 'restricted') return 'error';

	return account.status;
};

export const createOAuthAccountLinkedProviderCredentialResolver = async ({
	accountStore,
	now,
	providersConfiguration
}: CreateOAuthAccountLinkedProviderCredentialResolverOptions) => {
	const grantStore: LinkedProviderGrantStore = {
		getGrant: async (id) => {
			const account = await accountStore.getAccount(id);

			return account ? toGrant(account) : undefined;
		},
		listGrantsByOwner: async (ownerRef) =>
			(await accountStore.listAccountsByOwner(ownerRef)).map(toGrant),
		saveGrant: async (grant) => {
			const account = await accountStore.getAccount(grant.id);
			if (!account)
				throw new Error('OAuth linked account is unavailable');
			await accountStore.saveAccount(accountWithGrant(account, grant));
		}
	};
	const bindingStore: LinkedProviderBindingStore = {
		getBinding: async (id) => {
			const accountId = accountIdFromBinding(id);
			if (!accountId) return undefined;
			const account = await accountStore.getAccount(accountId);

			return account ? toBinding(account) : undefined;
		},
		listBindingsByGrant: async (grantId) => {
			const account = await accountStore.getAccount(grantId);

			return account ? [toBinding(account)] : [];
		},
		listBindingsByOwner: async (ownerRef) =>
			(await accountStore.listAccountsByOwner(ownerRef)).map(toBinding),
		saveBinding: async (binding) => {
			const account = await accountStore.getAccount(binding.grantId);
			if (!account)
				throw new Error('OAuth linked account is unavailable');
			await accountStore.saveAccount({
				...account,
				metadata: binding.metadata,
				status: accountStatusForBinding(account, binding),
				updatedAt: binding.updatedAt
			});
		}
	};

	return createOAuthLinkedProviderCredentialResolver({
		bindingStore,
		grantStore,
		...(now ? { now } : {}),
		providersConfiguration
	});
};
