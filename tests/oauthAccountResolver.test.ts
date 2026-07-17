import { describe, expect, test } from 'bun:test';
import {
	createOAuthAccountLinkedProviderCredentialResolver,
	type OAuthLinkedProviderAccount,
	type OAuthLinkedProviderAccountStore
} from '../src';

const INITIAL_ACCOUNT: OAuthLinkedProviderAccount = {
	accessToken: 'github-user-token',
	authProviderKey: 'github',
	createdAt: 1_000,
	grantedScopes: ['read:user'],
	id: 'account-1',
	ownerRef: 'user-1',
	providerSubject: 'octocat',
	status: 'active',
	tokenType: 'bearer',
	updatedAt: 1_000
};
const FAILURE_TIME = 2_000;

const inMemoryAccountStore = (initial: OAuthLinkedProviderAccount[]) => {
	const accounts = new Map(initial.map((item) => [item.id, item]));
	const store: OAuthLinkedProviderAccountStore = {
		getAccount: async (id) => accounts.get(id),
		listAccountsByOwner: async (ownerRef) =>
			[...accounts.values()].filter((item) => item.ownerRef === ownerRef),
		saveAccount: async (item) => {
			accounts.set(item.id, item);
		}
	};

	return { accounts, store };
};

describe('OAuth-account linked-provider resolver', () => {
	test('leases an existing OAuth account through the neutral resolver', async () => {
		const { store } = inMemoryAccountStore([{ ...INITIAL_ACCOUNT }]);
		const resolver =
			await createOAuthAccountLinkedProviderCredentialResolver({
				accountStore: store,
				providersConfiguration: {}
			});
		const credential = await resolver.resolveCredential({
			connectorProvider: 'github',
			ownerRef: 'user-1',
			purpose: 'interactive_test',
			requiredScopes: ['read:user']
		});

		expect(credential).toMatchObject({
			authProviderKey: 'github',
			bindingId: 'oauth-account:account-1',
			externalAccountId: 'octocat'
		});
		if (!credential) throw new Error('Expected a linked credential');
		expect(
			await resolver.getAccessToken(credential, {
				requiredScopes: ['read:user']
			})
		).toEqual({
			accessToken: 'github-user-token',
			expiresAt: undefined,
			grantedScopes: ['read:user'],
			tokenType: 'bearer'
		});
	});

	test('persists provider authorization failures on the OAuth account', async () => {
		const { accounts, store } = inMemoryAccountStore([
			{ ...INITIAL_ACCOUNT }
		]);
		const resolver =
			await createOAuthAccountLinkedProviderCredentialResolver({
				accountStore: store,
				providersConfiguration: {},
				now: () => FAILURE_TIME
			});
		const credential = await resolver.resolveCredential({
			connectorProvider: 'github',
			ownerRef: 'user-1',
			purpose: 'interactive_test'
		});
		if (!credential) throw new Error('Expected a linked credential');

		await resolver.reportFailure(credential, {
			code: 'unauthorized',
			message: 'Token revoked'
		});

		expect(accounts.get('account-1')).toMatchObject({
			metadata: {
				lastCredentialFailureCode: 'unauthorized',
				lastCredentialFailureMessage: 'Token revoked'
			},
			status: 'revoked',
			updatedAt: FAILURE_TIME
		});
	});
});
