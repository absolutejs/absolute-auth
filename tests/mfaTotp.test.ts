import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { generateTotp } from '../src/crypto';
import type { MfaRouteProps } from '../src/mfa/config';
import { createInMemoryMfaStore } from '../src/mfa/inMemoryMfaStore';
import { mfaTotpRoutes } from '../src/mfa/totp';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { TEST_SESSION_ID } from './setup';

type TestUser = {
	email: string;
	sub: string;
};

const SESSION_TTL_MS = 60_000;
const EXPECTED_BACKUP_CODES = 10;

const buildTotpApp = async () => {
	const mfaStore = createInMemoryMfaStore();
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	await authSessionStore.setSession(TEST_SESSION_ID, {
		expiresAt: Date.now() + SESSION_TTL_MS,
		user: { email: 'mfa@example.com', sub: 'user-mfa' }
	});
	const config: MfaRouteProps<TestUser> = {
		authSessionStore,
		mfaStore,
		getChallengeUser: () => null,
		getUserId: (user) => user.sub
	};
	const app = new Elysia().use(mfaTotpRoutes(config));

	return { app, mfaStore };
};

const authedPost = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	body: unknown
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: JSON.stringify(body),
			headers: {
				'content-type': 'application/json',
				cookie: `user_session_id=${TEST_SESSION_ID}`
			},
			method: 'POST'
		})
	);

describe('TOTP enrollment', () => {
	test('sets up TOTP and issues backup codes on verify', async () => {
		const { app, mfaStore } = await buildTotpApp();

		const setupRes = await authedPost(app, '/auth/mfa/totp/setup', {});
		expect(setupRes.status).toBe(200);
		const setup = await setupRes.json();
		expect(setup.uri).toContain('otpauth://totp/');

		const code = await generateTotp({ secret: setup.secret });
		const verifyRes = await authedPost(app, '/auth/mfa/totp/verify', {
			code
		});
		expect(verifyRes.status).toBe(200);
		const verified = await verifyRes.json();
		expect(verified.backupCodes).toHaveLength(EXPECTED_BACKUP_CODES);

		const enrollment = await mfaStore.getEnrollment('user-mfa');
		expect(enrollment?.totpVerified).toBe(true);
	});

	test('rejects an invalid TOTP code', async () => {
		const { app } = await buildTotpApp();

		await authedPost(app, '/auth/mfa/totp/setup', {});
		const verifyRes = await authedPost(app, '/auth/mfa/totp/verify', {
			code: '000000'
		});

		expect(verifyRes.status).toBe(400);
	});

	test('requires authentication to set up', async () => {
		const { app } = await buildTotpApp();

		const res = await app.handle(
			new Request('http://localhost/auth/mfa/totp/setup', {
				body: '{}',
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);

		expect(res.status).toBe(401);
	});
});
