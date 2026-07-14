import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { MfaRouteProps } from '../src/mfa/config';
import { createInMemoryMfaStore } from '../src/mfa/inMemoryMfaStore';
import { mfaManagementRoutes } from '../src/mfa/management';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { TEST_SESSION_ID } from './setup';

type TestUser = { sub: string };
const USER_ID = 'mfa-management-user';

const buildApp = async () => {
	const mfaStore = createInMemoryMfaStore();
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	await authSessionStore.setSession(TEST_SESSION_ID, {
		expiresAt: Date.now() + 60_000,
		user: { sub: USER_ID }
	});
	const config: MfaRouteProps<TestUser> = {
		authSessionStore,
		mfaStore,
		getChallengeUser: () => null,
		getUserId: (user) => user.sub
	};

	return { app: new Elysia().use(mfaManagementRoutes(config)), mfaStore };
};

const request = (app: Elysia, method: 'DELETE' | 'GET', authenticated = true) =>
	app.handle(
		new Request('http://localhost/auth/mfa', {
			headers: authenticated
				? { cookie: `user_session_id=${TEST_SESSION_ID}` }
				: undefined,
			method
		})
	);

describe('MFA management', () => {
	test('requires authentication', async () => {
		const { app } = await buildApp();
		expect((await request(app, 'GET', false)).status).toBe(401);
		expect((await request(app, 'DELETE', false)).status).toBe(401);
	});

	test('returns a safe summary of the enrolled factors', async () => {
		const { app, mfaStore } = await buildApp();
		await mfaStore.saveEnrollment({
			backupCodeHashes: ['hash-1', 'hash-2'],
			createdAt: Date.now(),
			smsPhone: '+12125551234',
			smsVerified: true,
			totpSecretCiphertext: 'encrypted-secret',
			totpVerified: true,
			updatedAt: Date.now(),
			userId: USER_ID
		});

		const response = await request(app, 'GET');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			backupCodesRemaining: 2,
			enabled: true,
			smsBackup: { enabled: true, phone: '********1234' },
			totp: { enabled: true }
		});
	});

	test('removes the persisted enrollment', async () => {
		const { app, mfaStore } = await buildApp();
		await mfaStore.saveEnrollment({
			backupCodeHashes: [],
			createdAt: Date.now(),
			smsVerified: false,
			totpSecretCiphertext: 'encrypted-secret',
			totpVerified: true,
			updatedAt: Date.now(),
			userId: USER_ID
		});

		const response = await request(app, 'DELETE');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'disabled' });
		expect(await mfaStore.getEnrollment(USER_ID)).toBeUndefined();
	});
});
