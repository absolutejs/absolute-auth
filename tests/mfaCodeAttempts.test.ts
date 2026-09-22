import { describe, expect, test, spyOn } from 'bun:test';
import { Elysia } from 'elysia';
import { generateTotp, generateTotpSecret, hashToken } from '../src/crypto';
import { mfaChallenge } from '../src/mfa/challenge';
import { createInMemoryMfaStore } from '../src/mfa/inMemoryMfaStore';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { TEST_SESSION_ID } from './setup';

const build = async () => {
	const user = { sub: 'mfa-test' };
	const store = createInMemoryMfaStore();
	const sessions = createInMemoryAuthSessionStore<typeof user>();
	const secret = generateTotpSecret();
	const otherSecret = generateTotpSecret();
	await store.saveEnrollment({
		backupCodeHashes: [await hashToken('recovery_11')],
		createdAt: Date.now(),
		factors: [
			{
				id: 'first',
				label: 'First app',
				secretCiphertext: secret,
				type: 'totp',
				verified: true
			},
			{
				id: 'second',
				label: 'Second app',
				secretCiphertext: otherSecret,
				type: 'totp',
				verified: true
			}
		],
		smsVerified: false,
		totpFailedAttempts: 5,
		totpVerified: true,
		updatedAt: Date.now(),
		userId: user.sub
	});
	await sessions.setUnregisteredSession(TEST_SESSION_ID, {
		expiresAt: Date.now() + 60_000,
		userIdentity: { sub: user.sub }
	});
	const app = new Elysia().use(
		mfaChallenge({
			authSessionStore: sessions,
			backupCodeMaxAttempts: 2,
			codeAttemptWindowMs: 10_000,
			mfaStore: store,
			totpMaxAttempts: 3,
			getChallengeUser: () => user,
			getUserId: (value) => value.sub
		})
	);
	const post = (code: string, factor = 'totp', factorId?: string) =>
		app.handle(
			new Request('http://localhost/auth/mfa/challenge', {
				body: JSON.stringify({ code, factor, factorId }),
				headers: {
					'content-type': 'application/json',
					cookie: `user_session_id=${TEST_SESSION_ID}`
				},
				method: 'POST'
			})
		);

	return { otherSecret, post, secret, store };
};

describe('recoverable MFA code limits', () => {
	test('legacy permanently locked enrollments can authenticate', async () => {
		const { post, secret } = await build();
		expect(
			(await post(await generateTotp({ secret }), 'totp', 'first')).status
		).toBe(200);
	});
	test('blocked retries do not extend the window and a valid code works at expiry', async () => {
		const clock = spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
		try {
			const { post, secret } = await build();
			expect((await post('wrong')).status).toBe(401);
			expect((await post('wrong')).status).toBe(401);
			const last = await post('wrong');
			expect(last.status).toBe(429);
			expect(last.headers.get('Retry-After')).toBe('10');
			clock.mockReturnValue(1_800_000_009_000);
			const blocked = await post(await generateTotp({ secret }));
			expect(blocked.status).toBe(429);
			expect(await blocked.json()).toMatchObject({
				code: 'mfa_rate_limited',
				retryAfterMs: 1000
			});
			clock.mockReturnValue(1_800_000_010_000);
			expect((await post(await generateTotp({ secret }))).status).toBe(
				200
			);
		} finally {
			clock.mockRestore();
		}
	});
	test('recovery codes work during a TOTP cooldown and are consumed once', async () => {
		const { post, store } = await build();
		await post('wrong');
		await post('wrong');
		await post('wrong');
		expect((await post('recovery_11', 'backup_codes')).status).toBe(200);
		expect(
			(await store.getEnrollment('mfa-test'))?.backupCodeHashes
		).toEqual([]);
	});
	test('recovery guessing has its own budget and does not block authenticators', async () => {
		const { post, secret } = await build();
		expect((await post('wrong', 'backup_codes')).status).toBe(401);
		expect((await post('wrong', 'backup_codes')).status).toBe(429);
		expect((await post('recovery_11', 'backup_codes')).status).toBe(429);
		expect((await post(await generateTotp({ secret }))).status).toBe(200);
	});
	test('selecting another authenticator does not reset the shared budget', async () => {
		const { post, otherSecret } = await build();
		await post('wrong', 'totp', 'first');
		await post('wrong', 'totp', 'first');
		expect((await post('wrong', 'totp', 'second')).status).toBe(429);
		expect(
			(
				await post(
					await generateTotp({ secret: otherSecret }),
					'totp',
					'second'
				)
			).status
		).toBe(429);
	});
	test('a valid code from a different selected factor is rejected', async () => {
		const { post, otherSecret } = await build();
		const code = await generateTotp({ secret: otherSecret });
		expect((await post(code, 'totp', 'missing-factor')).status).toBe(401);
		expect((await post(code, 'totp', 'second')).status).toBe(200);
	});
	test('an expired pending session cannot be promoted', async () => {
		const clock = spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
		try {
			const { post, secret } = await build();
			clock.mockReturnValue(1_800_000_060_000);
			expect((await post(await generateTotp({ secret }))).status).toBe(
				401
			);
		} finally {
			clock.mockRestore();
		}
	});
	test('simultaneous requests cannot exceed the verification budget', async () => {
		const { post } = await build();
		const results = await Promise.all(
			Array.from({ length: 20 }, () => post('wrong'))
		);
		expect(results.filter((result) => result.status === 401)).toHaveLength(
			2
		);
		expect(results.filter((result) => result.status === 429)).toHaveLength(
			18
		);
	});
	test('recovery code consumption is atomic', async () => {
		const { store } = await build();
		const results = await Promise.all(
			Array.from({ length: 10 }, () =>
				store.completeCodeChallenge({
					backupCodeHash: undefined,
					now: Date.now(),
					userId: 'mfa-test'
				})
			)
		);
		expect(results.every(Boolean)).toBe(true);
		const hash = await hashToken('recovery_11');
		const consumed = await Promise.all(
			Array.from({ length: 10 }, () =>
				store.completeCodeChallenge({
					backupCodeHash: hash,
					now: Date.now(),
					userId: 'mfa-test'
				})
			)
		);
		expect(consumed.filter(Boolean)).toHaveLength(1);
	});
});
