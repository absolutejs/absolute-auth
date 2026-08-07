import { describe, expect, test } from 'bun:test';
import { createInMemoryLinkedProviderStores } from '../src';
import type { LinkedProviderGrant } from '@absolutejs/linked-providers';

const grant = (refreshTokenCiphertext?: string): LinkedProviderGrant => ({
	accessTokenCiphertext: 'access-1',
	authProviderKey: 'google',
	createdAt: 1,
	grantedScopes: ['contacts.readonly'],
	id: 'grant-1',
	ownerRef: 'user-1',
	providerFamily: 'google',
	providerSubject: 'google-user-1',
	refreshTokenCiphertext,
	status: 'active',
	updatedAt: 1
});

describe('linked-provider grant stores', () => {
	test('preserves the prior refresh token when reauthorization omits one', async () => {
		const { grantStore } = createInMemoryLinkedProviderStores({
			grants: [grant('refresh-1')]
		});
		await grantStore.saveGrant({
			...grant(),
			accessTokenCiphertext: 'access-2',
			updatedAt: 2
		});

		expect(await grantStore.getGrant('grant-1')).toMatchObject({
			accessTokenCiphertext: 'access-2',
			refreshTokenCiphertext: 'refresh-1',
			updatedAt: 2
		});
	});

	test('replaces the prior refresh token when the provider rotates it', async () => {
		const { grantStore } = createInMemoryLinkedProviderStores({
			grants: [grant('refresh-1')]
		});
		await grantStore.saveGrant({
			...grant('refresh-2'),
			updatedAt: 2
		});

		expect(await grantStore.getGrant('grant-1')).toMatchObject({
			refreshTokenCiphertext: 'refresh-2',
			updatedAt: 2
		});
	});
});
