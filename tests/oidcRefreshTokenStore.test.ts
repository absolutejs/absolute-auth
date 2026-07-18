import { describe, expect, test } from 'bun:test';
import { createInMemoryOidcRefreshTokenStore } from '../src/oidc/inMemoryStores';

const MINUTE_MS = 60_000;

describe('OIDC refresh-token store', () => {
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
					scopes: ['openid'],
					tokenHash,
					userId
				})
			)
		);

		expect(await store.deleteForUserClient('alice', 'client-a')).toBe(2);
		expect(await store.getToken('alice-a-1')).toBeUndefined();
		expect(await store.getToken('alice-a-2')).toBeUndefined();
		expect(await store.getToken('alice-b')).toBeDefined();
		expect(await store.getToken('bob-a')).toBeDefined();
		expect(await store.deleteForUserClient('alice', 'client-a')).toBe(0);
	});
});
