import { describe, expect, test } from 'bun:test';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryDeviceAuthorizationStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';

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
		expect(
			await devices.findByDeviceCodeHash('bob-device')
		).toBeDefined();
	});
});
