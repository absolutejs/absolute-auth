import { describe, expect, test } from 'bun:test';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryClientRegistrationTokenStore,
	createInMemoryDeviceAuthorizationStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { revokeOAuthClientCredentials } from '../src/oidc/operator';

const MINUTE_MS = 60_000;

describe('OIDC operator lifecycle', () => {
	test('revokes every renewable or pending credential for one client', async () => {
		const authorizationCodeStore = createInMemoryAuthorizationCodeStore();
		const clientRegistrationTokenStore =
			createInMemoryClientRegistrationTokenStore();
		const deviceAuthorizationStore =
			createInMemoryDeviceAuthorizationStore();
		const refreshTokenStore = createInMemoryOidcRefreshTokenStore();
		const clientId = 'target-client';
		const otherClientId = 'retained-client';
		const now = Date.now();
		await authorizationCodeStore.saveCode({
			clientId,
			codeChallenge: 'challenge',
			codeHash: 'target-code',
			createdAt: now,
			expiresAt: now + MINUTE_MS,
			redirectUri: 'https://client.test/callback',
			scopes: ['openid'],
			userId: 'user-1'
		});
		await authorizationCodeStore.saveCode({
			clientId: otherClientId,
			codeChallenge: 'challenge',
			codeHash: 'retained-code',
			createdAt: now,
			expiresAt: now + MINUTE_MS,
			redirectUri: 'https://client.test/callback',
			scopes: ['openid'],
			userId: 'user-1'
		});
		await deviceAuthorizationStore.saveDeviceAuthorization({
			clientId,
			createdAt: now,
			deviceCodeHash: 'target-device',
			expiresAt: now + MINUTE_MS,
			intervalSeconds: 5,
			scopes: ['openid'],
			status: 'pending',
			userCode: 'TARGET01'
		});
		await refreshTokenStore.saveToken({
			clientId,
			createdAt: now,
			expiresAt: now + MINUTE_MS,
			scopes: ['openid'],
			tokenHash: 'target-refresh',
			userId: 'user-1'
		});
		await clientRegistrationTokenStore.saveToken({
			clientId,
			createdAt: now,
			tokenHash: 'target-registration'
		});

		expect(
			await revokeOAuthClientCredentials(clientId, {
				authorizationCodeStore,
				clientRegistrationTokenStore,
				deviceAuthorizationStore,
				refreshTokenStore
			})
		).toEqual({
			revokedAuthorizationCodes: 1,
			revokedDeviceAuthorizations: 1,
			revokedRefreshTokens: 1,
			revokedRegistrationTokens: 1
		});
		expect(
			await authorizationCodeStore.consumeCode('target-code')
		).toBeUndefined();
		expect(
			await authorizationCodeStore.consumeCode('retained-code')
		).toBeDefined();
		expect(
			await deviceAuthorizationStore.findByDeviceCodeHash('target-device')
		).toBeUndefined();
		expect(
			await refreshTokenStore.getToken('target-refresh')
		).toBeUndefined();
		expect(
			await clientRegistrationTokenStore.findByTokenHash(
				'target-registration'
			)
		).toBeUndefined();
	});
});
