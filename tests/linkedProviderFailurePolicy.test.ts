import { describe, expect, test } from 'bun:test';
import type {
	LinkedProviderBinding,
	LinkedProviderGrant
} from '@absolutejs/linked-providers';
import {
	createInMemoryLinkedProviderStores,
	createLinkedProviderCredentialResolver
} from '../src';

const grant: LinkedProviderGrant = {
	accessTokenCiphertext: 'access-1',
	authProviderKey: 'github',
	createdAt: 1,
	grantedScopes: [],
	id: 'grant-1',
	ownerRef: 'user-1',
	providerFamily: 'github',
	providerSubject: 'account-1',
	status: 'active',
	updatedAt: 1
};

const binding: LinkedProviderBinding = {
	availableScopes: [],
	connectorProvider: 'github',
	createdAt: 1,
	externalAccountId: 'account-1',
	externalAccountType: 'user',
	grantId: 'grant-1',
	id: 'binding-1',
	status: 'active',
	updatedAt: 1
};

const resolverFor = (failurePolicy?: 'latch' | 'record') => {
	const stores = createInMemoryLinkedProviderStores({
		bindings: [binding],
		grants: [grant]
	});

	return {
		...stores,
		resolver: createLinkedProviderCredentialResolver({
			...stores,
			...(failurePolicy ? { failurePolicy } : {}),
			loadAccessTokenLease: (stored) => ({
				accessToken: stored.accessTokenCiphertext ?? '',
				grantedScopes: stored.grantedScopes
			})
		})
	};
};

const report = { code: 'unauthorized' as const, message: 'refused' };

describe('linked-provider failure policy', () => {
	test('latches the credential shut by default', async () => {
		const { bindingStore, grantStore, resolver } = resolverFor();
		const credential = await resolver.resolveCredential({
			connectorProvider: 'github',
			ownerRef: 'user-1'
		});
		if (!credential) throw new Error('credential did not resolve');
		await resolver.reportFailure(credential, report);

		expect((await grantStore.getGrant('grant-1'))?.status).toBe('revoked');
		expect((await bindingStore.getBinding('binding-1'))?.status).toBe(
			'disconnected'
		);
		expect(
			await resolver.resolveCredential({
				connectorProvider: 'github',
				ownerRef: 'user-1'
			})
		).toBeNull();
	});

	test('records the failure and leaves the credential usable', async () => {
		const { bindingStore, grantStore, resolver } = resolverFor('record');
		const credential = await resolver.resolveCredential({
			connectorProvider: 'github',
			ownerRef: 'user-1'
		});
		if (!credential) throw new Error('credential did not resolve');
		await resolver.reportFailure(credential, report);

		const failed = await grantStore.getGrant('grant-1');
		expect(failed?.status).toBe('active');
		expect(failed?.lastRefreshError).toBe('refused');
		expect(failed?.metadata?.lastCredentialFailureCode).toBe(
			'unauthorized'
		);
		expect((await bindingStore.getBinding('binding-1'))?.status).toBe(
			'active'
		);
		expect(
			await resolver.resolveCredential({
				connectorProvider: 'github',
				ownerRef: 'user-1'
			})
		).toMatchObject({ bindingId: 'binding-1' });
	});
});
