import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { MfaRouteProps, SmsCodeMessage } from '../src/mfa/config';
import { createInMemoryMfaStore } from '../src/mfa/inMemoryMfaStore';
import { mfaSmsRoutes } from '../src/mfa/sms';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import {
	type VerificationCheckInput,
	type VerificationCheckStatus,
	type VerificationProvider,
	VerificationProviderError,
	type VerificationStartInput
} from '../src/verification/types';
import { TEST_SESSION_ID } from './setup';

type TestUser = { email: string; sub: string };

const PHONE = '+12025550100';
const USER_ID = 'user-sms';

const createProvider = () => {
	const checks: VerificationCheckInput[] = [];
	const starts: VerificationStartInput[] = [];
	let status: VerificationCheckStatus = 'approved';
	const provider: VerificationProvider = {
		name: 'test-verify',
		cancel: async () => undefined,
		check: async (input) => {
			checks.push(input);

			return { status };
		},
		start: async (input) => {
			starts.push(input);

			return { expiresAt: Date.now() + 300_000, reference: 'verify-1' };
		}
	};

	return {
		checks,
		provider,
		starts,
		setStatus: (next: VerificationCheckStatus) => {
			status = next;
		}
	};
};

const buildApp = async (overrides: Partial<MfaRouteProps<TestUser>> = {}) => {
	const mfaStore = createInMemoryMfaStore();
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	await authSessionStore.setSession(TEST_SESSION_ID, {
		authenticatedAt: Date.now(),
		expiresAt: Date.now() + 60_000,
		user: { email: 'sms@example.com', sub: USER_ID }
	});
	const baseConfig: MfaRouteProps<TestUser> = {
		authSessionStore,
		mfaStore,
		getChallengeUser: () => null,
		getUserId: (user) => user.sub
	};
	const app = new Elysia().use(mfaSmsRoutes({ ...baseConfig, ...overrides }));

	return { app, authSessionStore, mfaStore };
};

const post = (
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

describe('SMS MFA enrollment', () => {
	test('delegates challenge lifecycle to a verification provider', async () => {
		const mock = createProvider();
		const { app, mfaStore } = await buildApp({
			verificationProvider: mock.provider
		});

		const setup = await post(app, '/auth/mfa/sms/setup', { phone: PHONE });
		expect(setup.status).toBe(200);
		expect(mock.starts).toEqual([
			{
				channel: 'sms',
				purpose: 'mfa_enrollment',
				subject: USER_ID,
				to: PHONE
			}
		]);
		expect(
			(await mfaStore.getEnrollment(USER_ID))?.smsPendingCodeHash
		).toBeUndefined();

		const verify = await post(app, '/auth/mfa/sms/verify', {
			code: '123456'
		});
		expect(verify.status).toBe(200);
		expect(mock.checks[0]?.reference).toBe('verify-1');
		expect((await mfaStore.getEnrollment(USER_ID))?.smsVerified).toBe(true);
	});

	test('maps provider rejection without enrolling the phone', async () => {
		const mock = createProvider();
		mock.setStatus('max_attempts_reached');
		const { app, mfaStore } = await buildApp({
			verificationProvider: mock.provider
		});
		await post(app, '/auth/mfa/sms/setup', { phone: PHONE });

		const verify = await post(app, '/auth/mfa/sms/verify', {
			code: 'wrong'
		});
		expect(verify.status).toBe(429);
		expect((await mfaStore.getEnrollment(USER_ID))?.smsVerified).toBe(
			false
		);
	});

	test('enforces a resend cooldown before calling the provider again', async () => {
		const mock = createProvider();
		const { app } = await buildApp({ verificationProvider: mock.provider });
		expect(
			(await post(app, '/auth/mfa/sms/setup', { phone: PHONE })).status
		).toBe(200);
		expect(
			(await post(app, '/auth/mfa/sms/setup', { phone: PHONE })).status
		).toBe(429);
		expect(mock.starts).toHaveLength(1);
	});

	test('atomically admits only one concurrent provider delivery', async () => {
		const mock = createProvider();
		const { app } = await buildApp({ verificationProvider: mock.provider });
		const responses = await Promise.all([
			post(app, '/auth/mfa/sms/setup', { phone: PHONE }),
			post(app, '/auth/mfa/sms/setup', { phone: PHONE })
		]);
		expect(responses.map(({ status }) => status).sort()).toEqual([
			200, 429
		]);
		expect(mock.starts).toHaveLength(1);
	});

	test('atomically consumes a provider challenge once', async () => {
		const mock = createProvider();
		const { app } = await buildApp({ verificationProvider: mock.provider });
		await post(app, '/auth/mfa/sms/setup', { phone: PHONE });
		const responses = await Promise.all([
			post(app, '/auth/mfa/sms/verify', { code: '123456' }),
			post(app, '/auth/mfa/sms/verify', { code: '123456' })
		]);
		expect(responses.map(({ status }) => status).sort()).toEqual([
			200, 400
		]);
	});

	test('requires recent authentication before changing the SMS factor', async () => {
		const { app, authSessionStore } = await buildApp({
			onSendSmsCode: () => undefined
		});
		await authSessionStore.setSession(TEST_SESSION_ID, {
			authenticatedAt: Date.now() - 600_000,
			expiresAt: Date.now() + 60_000,
			user: { email: 'sms@example.com', sub: USER_ID }
		});
		const response = await post(app, '/auth/mfa/sms/setup', {
			phone: PHONE
		});
		expect(response.status).toBe(401);
		expect(await response.text()).toContain(
			'Recent authentication required'
		);
	});

	test('maps normalized provider failures to a safe route response', async () => {
		const mock = createProvider();
		mock.provider.start = async () => {
			throw new VerificationProviderError({
				kind: 'rate_limited',
				message: 'provider detail must not leak',
				provider: 'test-verify'
			});
		};
		const { app } = await buildApp({ verificationProvider: mock.provider });
		const response = await post(app, '/auth/mfa/sms/setup', {
			phone: PHONE
		});
		expect(response.status).toBe(429);
		expect(await response.text()).not.toContain('provider detail');
	});

	test('keeps the built-in local-code flow as a provider-free option', async () => {
		const sent: SmsCodeMessage[] = [];
		const { app, mfaStore } = await buildApp({
			onSendSmsCode: (message) => {
				sent.push(message);
			}
		});
		await post(app, '/auth/mfa/sms/setup', { phone: PHONE });
		const [message] = sent;
		expect(message).toBeDefined();
		if (message === undefined) throw new Error('SMS code was not sent');
		expect(message).toMatchObject({
			phone: PHONE,
			purpose: 'mfa_enrollment',
			userId: USER_ID
		});

		const verify = await post(app, '/auth/mfa/sms/verify', {
			code: message.code
		});
		expect(verify.status).toBe(200);
		expect((await mfaStore.getEnrollment(USER_ID))?.smsVerified).toBe(true);
	});
});
