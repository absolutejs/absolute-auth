import { describe, expect, test } from 'bun:test';
import { createLinkedProviderCredentialResolver } from '../src/linkedProviders/resolver';
import { createOAuthLinkedProviderCredentialResolver } from '../src/linkedProviders/oauthResolver';
import { createInMemoryLinkedProviderStores } from '../src/linkedProviders/inMemoryStores';
import type { LinkedProviderGrant } from '@absolutejs/linked-providers';

const grant: LinkedProviderGrant = {
	accessTokenCiphertext: 'old',
	authProviderKey: 'google',
	createdAt: 0,
	expiresAt: 1,
	grantedScopes: ['mail'],
	id: 'g',
	ownerRef: 'u',
	providerFamily: 'google',
	providerSubject: 'mail',
	status: 'active',
	updatedAt: 0
};
const stores = () =>
	createInMemoryLinkedProviderStores({
		bindings: [
			{
				availableScopes: ['mail'],
				connectorProvider: 'google',
				createdAt: 0,
				email: 'member@example.com',
				externalAccountId: 'mail',
				externalAccountType: 'mailbox',
				grantId: 'g',
				id: 'b',
				status: 'active',
				updatedAt: 0
			}
		],
		grants: [grant]
	});
const credential = async (
	resolver: ReturnType<typeof createLinkedProviderCredentialResolver>
) => {
	const value = await resolver.resolveCredential({
		connectorProvider: 'google',
		ownerRef: 'u',
		purpose: 'background_sync'
	});
	if (!value) throw new Error('Missing credential');

	return value;
};
describe('credential refresh recovery', () => {
	test('missing refresh token requires reconnect and persists safe failure', async () => {
		const state = stores();
		const resolver = await createOAuthLinkedProviderCredentialResolver({
			...state,
			providersConfiguration: {}
		});
		await expect(
			resolver.getAccessToken(await credential(resolver))
		).rejects.toMatchObject({
			code: 'missing_refresh_token',
			recovery: 'reconnect'
		});
		expect(await state.grantStore.getGrant('g')).toMatchObject({
			lastRefreshError:
				'Authorization cannot renew automatically. Reconnect your account.',
			metadata: { credentialRecovery: 'reconnect' },
			status: 'revoked'
		});
	});
	test('temporary failure remains retryable; successful retry clears the error', async () => {
		const state = stores();
		let fail = true;
		const resolver = createLinkedProviderCredentialResolver({
			...state,
			loadAccessTokenLease: () => null,
			now: () => 100,
			refreshAccessTokenLease: async (stored) => {
				if (fail) throw new Error('network failure containing secret');

				return {
					grant: {
						...stored,
						lastRefreshedAt: 100,
						status: 'active'
					},
					lease: {
						accessToken: 'new',
						expiresAt: 1000,
						grantedScopes: ['mail']
					}
				};
			}
		});
		const resolved = await credential(resolver);
		await expect(resolver.getAccessToken(resolved)).rejects.toMatchObject({
			recovery: 'retry'
		});
		expect(
			(await state.grantStore.getGrant('g'))?.lastRefreshError
		).not.toContain('secret');
		fail = false;
		expect((await resolver.getAccessToken(resolved)).accessToken).toBe(
			'new'
		);
		expect(
			(await state.grantStore.getGrant('g'))?.metadata?.credentialRecovery
		).toBeUndefined();
		expect(
			(await state.grantStore.getGrant('g'))?.lastRefreshError
		).toBeUndefined();
	});
	test.each([
		['invalid_grant', 'reconnect'],
		['invalid_client', 'configuration'],
		['timeout', 'retry']
	] as const)('%s has recovery %s', async (code, recovery) => {
		const state = stores();
		const resolver = createLinkedProviderCredentialResolver({
			...state,
			loadAccessTokenLease: () => null,
			refreshAccessTokenLease: async () => {
				throw new Error(`OAuth token exchange failed: ${code}`);
			}
		});
		await expect(
			resolver.getAccessToken(await credential(resolver))
		).rejects.toMatchObject({
			name: 'LinkedProviderCredentialError',
			recovery
		});
	});
});

test('forged owner and rebound credentials cannot obtain tokens or report failures', async () => {
	const state = stores();
	const resolver = createLinkedProviderCredentialResolver({
		...state,
		loadAccessTokenLease: () => ({
			accessToken: 'secret',
			grantedScopes: ['mail']
		})
	});
	const valid = await credential(resolver);
	await expect(
		resolver.getAccessToken({ ...valid, ownerRef: 'other' })
	).rejects.toThrow();
	await resolver.reportFailure(
		{ ...valid, ownerRef: 'other' },
		{ code: 'revoked' }
	);
	expect((await state.grantStore.getGrant('g'))?.status).toBe('active');
	const binding = await state.bindingStore.getBinding('b');
 if (!binding) throw new Error('Missing binding');
	await state.bindingStore.saveBinding({
		...binding,
		grantId: 'replacement'
	});
	await expect(resolver.getAccessToken(valid)).rejects.toThrow();
});
