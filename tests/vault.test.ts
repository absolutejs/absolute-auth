import { describe, expect, test } from 'bun:test';
import { createSecretCipher } from '../src/compliance/cipher';
import { generateEncryptionKey } from '../src/crypto';
import { createVault, rotateVaultKey } from '../src/vault/config';
import { createInMemoryVaultStore } from '../src/vault/inMemoryVaultStore';

describe('vault', () => {
	test('put/get/list/delete round-trips an encrypted blob per owner', async () => {
		const key = await generateEncryptionKey();
		const store = createInMemoryVaultStore();
		const vault = createVault({ cipher: createSecretCipher(key), store });

		await vault.put('user-1', 'stripe_customer', 'cus_abc123');
		await vault.put('user-1', 'notion_token', 'secret_xyz');
		await vault.put('user-2', 'stripe_customer', 'cus_other');

		expect(await vault.get('user-1', 'stripe_customer')).toBe('cus_abc123');
		expect(await vault.get('user-1', 'notion_token')).toBe('secret_xyz');
		expect(await vault.get('user-2', 'stripe_customer')).toBe('cus_other');
		expect(await vault.get('user-1', 'missing')).toBeUndefined();

		expect((await vault.list('user-1')).sort()).toEqual([
			'notion_token',
			'stripe_customer'
		]);

		// ciphertext is what's stored, not plaintext
		const entry = await store.getEntry('user-1', 'stripe_customer');
		expect(entry?.encryptedValue).not.toContain('cus_abc123');

		await vault.delete('user-1', 'stripe_customer');
		expect(await vault.get('user-1', 'stripe_customer')).toBeUndefined();
	});

	test('put preserves createdAt across updates', async () => {
		const store = createInMemoryVaultStore();
		const vault = createVault({
			cipher: createSecretCipher(await generateEncryptionKey()),
			store
		});

		await vault.put('user-1', 'k', 'v1');
		const first = await store.getEntry('user-1', 'k');
		await Bun.sleep(5);
		await vault.put('user-1', 'k', 'v2');
		const second = await store.getEntry('user-1', 'k');

		expect(second?.createdAt).toBe(first?.createdAt);
		expect(second?.updatedAt).toBeGreaterThan(first?.updatedAt ?? 0);
	});

	test('rotateVaultKey re-encrypts every entry old key → new key', async () => {
		const oldKey = await generateEncryptionKey();
		const newKey = await generateEncryptionKey();
		const store = createInMemoryVaultStore();
		const oldVault = createVault({
			cipher: createSecretCipher(oldKey),
			store
		});

		await oldVault.put('user-1', 'a', 'alpha');
		await oldVault.put('user-1', 'b', 'beta');
		await oldVault.put('user-2', 'c', 'gamma');

		const result = await rotateVaultKey({ newKey, oldKey, store });
		expect(result.rotated).toBe(3);

		// Old key can no longer decrypt; new key can.
		const stillOld = createVault({
			cipher: createSecretCipher(oldKey),
			store
		});
		await expect(stillOld.get('user-1', 'a')).rejects.toThrow();

		const newVault = createVault({
			cipher: createSecretCipher(newKey),
			store
		});
		expect(await newVault.get('user-1', 'a')).toBe('alpha');
		expect(await newVault.get('user-1', 'b')).toBe('beta');
		expect(await newVault.get('user-2', 'c')).toBe('gamma');
	});
});
