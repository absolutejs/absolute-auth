import { describe, expect, test } from 'bun:test';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryDeviceAuthorizationStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';

const MINUTE_MS = 60_000;

describe('OIDC refresh-token store', () => {
	test('rotates atomically and revokes the descendant when an ancestor is replayed', async () => {
		const store = createInMemoryOidcRefreshTokenStore();
		const now = Date.now();
		const first = {
			clientId: 'mobile-app',
			createdAt: now,
			expiresAt: now + MINUTE_MS,
			familyId: 'mobile-family',
			scopes: ['openid'],
			tokenHash: 'refresh-1',
			userId: 'alice'
		};
		const second = { ...first, tokenHash: 'refresh-2' };
		await store.saveToken(first);

		expect(await store.rotateToken(first.tokenHash, second)).toBe(true);
		expect(await store.getToken(first.tokenHash)).toBeUndefined();
		expect(await store.getToken(second.tokenHash)).toEqual(second);
		expect(await store.rotateToken(first.tokenHash, first)).toBe(false);
		expect(await store.getToken(second.tokenHash)).toBeUndefined();
		expect(await store.listConnections()).toEqual([]);
	});

	test('deletes only one user and client connection', async () => {
		const store = createInMemoryOidcRefreshTokenStore();
		const now = Date.now();
		const tokens: Array<{
			clientId: string;
			tokenHash: string;
			userId: string;
		}> = [
			{ clientId: 'client-a', tokenHash: 'alice-a-1', userId: 'alice' },
			{ clientId: 'client-a', tokenHash: 'alice-a-2', userId: 'alice' },
			{ clientId: 'client-b', tokenHash: 'alice-b', userId: 'alice' },
			{ clientId: 'client-a', tokenHash: 'bob-a', userId: 'bob' }
		];
		await Promise.all(
			tokens.map(({ clientId, tokenHash, userId }) =>
				store.saveToken({
					clientId,
					createdAt: now,
					expiresAt: now + MINUTE_MS,
					familyId: `family-${tokenHash}`,
					scopes: ['openid'],
					tokenHash,
					userId
				})
			)
		);
		expect(await store.listConnections()).toEqual([
			{ clientId: 'client-a', userId: 'alice' },
			{ clientId: 'client-b', userId: 'alice' },
			{ clientId: 'client-a', userId: 'bob' }
		]);

		expect(await store.deleteForUserClient('alice', 'client-a')).toBe(2);
		expect(await store.getToken('alice-a-1')).toBeUndefined();
		expect(await store.getToken('alice-a-2')).toBeUndefined();
		expect(await store.getToken('alice-b')).toBeDefined();
		expect(await store.getToken('bob-a')).toBeDefined();
		expect(await store.deleteForUserClient('alice', 'client-a')).toBe(0);
	});

	test('revoking a consumed ancestor deletes its active family descendant', async () => {
		const store = createInMemoryOidcRefreshTokenStore();
		const now = Date.now();
		const first = {
			clientId: 'mobile-app',
			createdAt: now,
			expiresAt: now + MINUTE_MS,
			familyId: 'family',
			scopes: ['openid'],
			tokenHash: 'first',
			userId: 'alice'
		};
		const second = { ...first, tokenHash: 'second' };
		await store.saveToken(first);
		await store.rotateToken(first.tokenHash, second);

		expect(await store.consumeToken(first.tokenHash)).toEqual(second);
		expect(await store.getToken(second.tokenHash)).toBeUndefined();
	});

	test('deletes issued codes and approved device grants for one connection', async () => {
		const codes = createInMemoryAuthorizationCodeStore();
		const devices = createInMemoryDeviceAuthorizationStore();
		const now = Date.now();
		await Promise.all([
			codes.saveCode({
				clientId: 'client-a',
				codeChallenge: 'challenge',
				codeHash: 'alice-code',
				createdAt: now,
				expiresAt: now + MINUTE_MS,
				redirectUri: 'https://client.example/callback',
				scopes: ['openid'],
				userId: 'alice'
			}),
			codes.saveCode({
				clientId: 'client-b',
				codeChallenge: 'challenge',
				codeHash: 'other-code',
				createdAt: now,
				expiresAt: now + MINUTE_MS,
				redirectUri: 'https://other.example/callback',
				scopes: ['openid'],
				userId: 'alice'
			}),
			devices.saveDeviceAuthorization({
				clientId: 'client-a',
				createdAt: now,
				deviceCodeHash: 'alice-device',
				expiresAt: now + MINUTE_MS,
				intervalSeconds: 5,
				scopes: ['openid'],
				status: 'approved',
				userCode: 'ALICE',
				userSub: 'alice'
			}),
			devices.saveDeviceAuthorization({
				clientId: 'client-a',
				createdAt: now,
				deviceCodeHash: 'bob-device',
				expiresAt: now + MINUTE_MS,
				intervalSeconds: 5,
				scopes: ['openid'],
				status: 'approved',
				userCode: 'BOB',
				userSub: 'bob'
			})
		]);

		expect(await codes.deleteForUserClient('alice', 'client-a')).toBe(1);
		expect(await devices.deleteForUserClient('alice', 'client-a')).toBe(1);
		expect(await codes.consumeCode('alice-code')).toBeUndefined();
		expect(await codes.consumeCode('other-code')).toBeDefined();
		expect(
			await devices.findByDeviceCodeHash('alice-device')
		).toBeUndefined();
		expect(await devices.findByDeviceCodeHash('bob-device')).toBeDefined();
	});
});

describe('OIDC refresh-token families', () => {
	const family = (
		familyId: string,
		overrides: Partial<{
			clientId: string;
			createdAt: number;
			expiresAt: number;
			userId: string;
		}> = {}
	) => {
		const now = Date.now();

		return {
			clientId: 'terminal',
			createdAt: now,
			expiresAt: now + MINUTE_MS,
			familyId,
			scopes: ['codes'],
			tokenHash: `${familyId}-hash`,
			userId: 'alice',
			...overrides
		};
	};

	test('lists active families per user and client without token hashes', async () => {
		const store = createInMemoryOidcRefreshTokenStore();
		const now = Date.now();
		await store.saveToken(family('laptop', { createdAt: now - 2 }));
		await store.saveToken(family('desktop', { createdAt: now - 1 }));
		await store.saveToken(family('other-client', { clientId: 'web' }));
		await store.saveToken(family('bob', { userId: 'bob' }));
		await store.saveToken(family('expired', { expiresAt: now - 1 }));

		const listed = await store.listFamilies?.('alice', 'terminal');
		expect(listed?.map((entry) => entry.familyId)).toEqual([
			'desktop',
			'laptop'
		]);
		expect(listed?.[0]).not.toHaveProperty('tokenHash');
		expect(listed?.[0]?.issuedAt).toBe(now - 1);
		expect(
			(await store.listFamilies?.('alice'))?.map(
				(entry) => entry.familyId
			)
		).toContain('other-client');
		expect(await store.getFamily?.('expired')).toBeUndefined();
	});

	test('tracks the latest rotation as the family issue time', async () => {
		const store = createInMemoryOidcRefreshTokenStore();
		const first = family('laptop', { createdAt: 1_000 });
		await store.saveToken(first);
		const later = Date.now();
		await store.rotateToken(first.tokenHash, {
			...first,
			createdAt: later,
			tokenHash: 'laptop-rotated'
		});

		expect((await store.getFamily?.('laptop'))?.issuedAt).toBe(later);
	});

	test('revokes one family and leaves the user’s other grants', async () => {
		const store = createInMemoryOidcRefreshTokenStore();
		await store.saveToken(family('laptop'));
		await store.saveToken(family('desktop'));

		expect(await store.revokeFamily?.('bob', 'laptop')).toBe(false);
		expect(await store.getFamily?.('laptop')).toBeDefined();
		expect(await store.revokeFamily?.('alice', 'laptop')).toBe(true);
		expect(await store.getFamily?.('laptop')).toBeUndefined();
		expect(await store.getToken('laptop-hash')).toBeUndefined();
		expect(await store.getFamily?.('desktop')).toBeDefined();
		expect(await store.revokeFamily?.('alice', 'laptop')).toBe(false);
	});

	test('a replay-revoked family is no longer listed or found', async () => {
		const store = createInMemoryOidcRefreshTokenStore();
		const first = family('laptop');
		await store.saveToken(first);
		await store.rotateToken(first.tokenHash, {
			...first,
			tokenHash: 'laptop-2'
		});
		await store.rotateToken(first.tokenHash, first);

		expect(await store.getFamily?.('laptop')).toBeUndefined();
		expect(await store.listFamilies?.('alice')).toEqual([]);
	});
});
