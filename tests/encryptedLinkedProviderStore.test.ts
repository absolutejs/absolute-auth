import { expect, test } from 'bun:test';
import {
	createEncryptedLinkedProviderGrantStore,
	createInMemoryLinkedProviderStores,
	createSecretCipher
} from '../src';
import type { LinkedProviderGrant } from '@absolutejs/linked-providers';
const grant: LinkedProviderGrant = {
	accessTokenCiphertext: 'private-access',
	authProviderKey: 'google',
	createdAt: 1,
	grantedScopes: ['mail'],
	id: 'one',
	ownerRef: 'alice',
	providerFamily: 'google',
	providerSubject: 'subject',
	refreshTokenCiphertext: 'private-refresh',
	status: 'active',
	updatedAt: 1
};
const fixture = () => {
	const { grantStore: raw } = createInMemoryLinkedProviderStores();
	const cipher = createSecretCipher(
		Buffer.alloc(32, 7).toString('base64url')
	);

	return {
		raw,
		store: createEncryptedLinkedProviderGrantStore({ cipher, store: raw })
	};
};
test('encrypts tokens at rest, decrypts only through the server view and preserves omitted refresh tokens', async () => {
	const { raw, store } = fixture();
	await store.saveGrant(grant);
	expect(JSON.stringify(await raw.getGrant('one'))).not.toContain('private-');
	expect(await store.getGrant('one')).toEqual(grant);
	await store.saveGrant({
		...grant,
		accessTokenCiphertext: 'new-access',
		refreshTokenCiphertext: undefined
	});
	expect((await store.getGrant('one'))?.refreshTokenCiphertext).toBe(
		'private-refresh'
	);
	expect(
		(await store.listGrantsByOwner('alice'))[0]?.accessTokenCiphertext
	).toBe('new-access');
	expect(await store.listGrantsByOwner('bob')).toEqual([]);
	await store.removeGrant('one');
	expect(await store.getGrant('one')).toBeUndefined();
});
test('rejects plaintext and ciphertext transplanted to another owner, grant or token field', async () => {
	const { raw, store } = fixture();
	await raw.saveGrant(grant);
	await expect(store.getGrant('one')).rejects.toThrow();
	await store.saveGrant(grant);
	const encrypted = await raw.getGrant('one');
	if (!encrypted) throw new Error('Missing fixture');
	await Promise.all(
		[
			{ ownerRef: 'bob' },
			{ id: 'two' },
			{ accessTokenCiphertext: encrypted.refreshTokenCiphertext }
		].map(async (change) => {
			const changed = { ...encrypted, ...change };
			await raw.saveGrant(changed);
			await expect(store.getGrant(changed.id)).rejects.toThrow();
		})
	);
});
