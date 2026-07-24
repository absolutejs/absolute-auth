import { describe, expect, test } from 'bun:test';
import { createSecretCipher } from '../src/compliance/cipher';
import { generateEncryptionKey } from '../src/crypto';
import {
	createFederatedTokenStore,
	getOrRefreshFederatedTokens,
	type FederatedTokenSet
} from '../src/federation/tokenStore';
import { createVault } from '../src/vault/config';
import { createInMemoryVaultStore } from '../src/vault/inMemoryVaultStore';

const CIPHER_KEY = generateEncryptionKey();

const buildVault = () =>
	createVault({
		cipher: createSecretCipher(CIPHER_KEY),
		store: createInMemoryVaultStore()
	});

describe('FederatedTokenStore', () => {
	test('save → get round-trips the token set', async () => {
		const store = createFederatedTokenStore(buildVault());
		await store.save('user-alice', 'google', {
			accessToken: 'ya29.access',
			expiresAt: Date.now() + 3600 * 1000,
			refreshToken: '1//refresh',
			scopes: ['email', 'profile'],
			tokenType: 'Bearer'
		});

		const got = await store.get('user-alice', 'google');
		expect(got?.accessToken).toBe('ya29.access');
		expect(got?.refreshToken).toBe('1//refresh');
		expect(got?.scopes).toEqual(['email', 'profile']);
		expect(got?.storedAt).toBeGreaterThan(0);
	});

	test('save isolates by (userId, provider)', async () => {
		const store = createFederatedTokenStore(buildVault());
		await store.save('user-a', 'google', { accessToken: 'a-google' });
		await store.save('user-a', 'slack', { accessToken: 'a-slack' });
		await store.save('user-b', 'google', { accessToken: 'b-google' });

		expect((await store.get('user-a', 'google'))?.accessToken).toBe(
			'a-google'
		);
		expect((await store.get('user-a', 'slack'))?.accessToken).toBe(
			'a-slack'
		);
		expect((await store.get('user-b', 'google'))?.accessToken).toBe(
			'b-google'
		);
	});

	test('list returns just the federated providers for a user (not other vault entries)', async () => {
		const vault = buildVault();
		const store = createFederatedTokenStore(vault);
		await store.save('user-x', 'google', { accessToken: 'g' });
		await store.save('user-x', 'github', { accessToken: 'gh' });
		// A non-federated vault entry under the same owner — must NOT show up in list.
		await vault.put('user-x', 'unrelated:secret', 'shh');

		const providers = await store.list('user-x');
		expect(providers.sort()).toEqual(['github', 'google']);
	});

	test('delete clears the stored token', async () => {
		const store = createFederatedTokenStore(buildVault());
		await store.save('user-a', 'google', { accessToken: 'a' });
		await store.delete('user-a', 'google');
		expect(await store.get('user-a', 'google')).toBeUndefined();
	});

	test('delete with a revoke callback calls it BEFORE deleting + swallows errors', async () => {
		const store = createFederatedTokenStore(buildVault());
		await store.save('user-a', 'google', {
			accessToken: 'access',
			refreshToken: 'refresh'
		});

		let revokeCalled: FederatedTokenSet | undefined;
		await store.delete('user-a', 'google', async (tokens) => {
			revokeCalled = tokens;
		});
		expect(revokeCalled?.accessToken).toBe('access');
		expect(await store.get('user-a', 'google')).toBeUndefined();

		// Save another, delete with a throwing revoke — should still delete.
		await store.save('user-a', 'google', { accessToken: 'x' });
		await store.delete('user-a', 'google', async () => {
			throw new Error('upstream revoke failed');
		});
		expect(await store.get('user-a', 'google')).toBeUndefined();
	});
});

describe('getOrRefreshFederatedTokens', () => {
	test('returns current tokens unchanged when not expired', async () => {
		const store = createFederatedTokenStore(buildVault());
		await store.save('user-a', 'google', {
			accessToken: 'fresh',
			expiresAt: Date.now() + 3600 * 1000,
			refreshToken: 'r'
		});
		let refreshCalls = 0;
		const got = await getOrRefreshFederatedTokens({
			provider: 'google',
			store,
			userId: 'user-a',
			refresh: async () => {
				refreshCalls += 1;

				return { access_token: 'should-not-refresh' };
			}
		});
		expect(got?.accessToken).toBe('fresh');
		expect(refreshCalls).toBe(0);
	});

	test('refreshes when expired AND refresh fn + refreshToken are both present', async () => {
		const store = createFederatedTokenStore(buildVault());
		await store.save('user-a', 'google', {
			accessToken: 'stale',
			expiresAt: Date.now() - 1000,
			refreshToken: 'r1'
		});

		const got = await getOrRefreshFederatedTokens({
			provider: 'google',
			store,
			userId: 'user-a',
			refresh: async (refreshToken) => {
				expect(refreshToken).toBe('r1');

				return {
					access_token: 'new-access',
					expires_in: 3600,
					refresh_token: 'r2',
					token_type: 'Bearer'
				};
			}
		});

		expect(got?.accessToken).toBe('new-access');
		expect(got?.refreshToken).toBe('r2');
		expect(got?.tokenType).toBe('Bearer');
		// The new tokens get persisted — next get returns them.
		const persisted = await store.get('user-a', 'google');
		expect(persisted?.accessToken).toBe('new-access');
	});

	test('returns existing tokens when refresh fn is missing', async () => {
		const store = createFederatedTokenStore(buildVault());
		await store.save('user-a', 'google', {
			accessToken: 'stale',
			expiresAt: Date.now() - 1000,
			refreshToken: 'r'
		});
		const got = await getOrRefreshFederatedTokens({
			provider: 'google',
			store,
			userId: 'user-a'
		});
		expect(got?.accessToken).toBe('stale');
	});

	test('returns undefined when nothing is stored', async () => {
		const store = createFederatedTokenStore(buildVault());
		const got = await getOrRefreshFederatedTokens({
			provider: 'google',
			store,
			userId: 'nobody'
		});
		expect(got).toBeUndefined();
	});

	test('preserves the prior refreshToken when the provider does not return a new one', async () => {
		const store = createFederatedTokenStore(buildVault());
		await store.save('user-a', 'google', {
			accessToken: 'stale',
			expiresAt: Date.now() - 1000,
			refreshToken: 'r-prior'
		});
		const got = await getOrRefreshFederatedTokens({
			provider: 'google',
			store,
			userId: 'user-a',
			refresh: async () => ({
				access_token: 'fresh',
				expires_in: 3600
				// no refresh_token returned
			})
		});
		expect(got?.refreshToken).toBe('r-prior');
	});
});
