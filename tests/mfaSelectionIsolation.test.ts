import { test, expect } from 'bun:test';
import { Elysia } from 'elysia';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { createInMemoryMfaStore } from '../src/mfa/inMemoryMfaStore';
import { mfaChallenge } from '../src/mfa/challenge';
import { generateTotpSecret, generateTotp } from '../src/crypto';
const fixture = async (cooldown: number, smsSendMaxAttempts = 10) => {
	const sessions = createInMemoryAuthSessionStore<{ sub: string }>();
	const store = createInMemoryMfaStore();
	const user = { sub: 'shared-audit' };
	const first = crypto.randomUUID(),
		second = crypto.randomUUID();
	await sessions.setUnregisteredSession(first, {
		expiresAt: Date.now() + 60000,
		userIdentity: { email: 'audit@example.com' }
	});
	await sessions.setUnregisteredSession(second, {
		expiresAt: Date.now() + 60000,
		userIdentity: { email: 'audit@example.com' }
	});
	const secretA = generateTotpSecret(),
		secretB = generateTotpSecret();
	await store.saveEnrollment({
		backupCodeHashes: [],
		createdAt: Date.now(),
		factors: [
			{
				id: 'phone-a',
				label: 'Alex',
				phone: '+12025550100',
				type: 'sms',
				verified: true
			},
			{
				id: 'phone-b',
				label: 'Sam',
				phone: '+12025550101',
				type: 'sms',
				verified: true
			},
			{
				id: 'totp-a',
				label: 'Alex',
				secretCiphertext: secretA,
				type: 'totp',
				verified: true
			},
			{
				id: 'totp-b',
				label: 'Sam',
				secretCiphertext: secretB,
				type: 'totp',
				verified: true
			}
		],
		smsVerified: true,
		totpVerified: true,
		updatedAt: Date.now(),
		userId: user.sub
	});
	const sent: string[] = [];
	const app = new Elysia().use(
		mfaChallenge({
			authSessionStore: sessions,
			mfaStore: store,
			smsResendCooldownMs: cooldown,
			smsSendMaxAttempts,
			getChallengeUser: () => user,
			getUserId: (u) => u.sub,
			onSendSmsCode: ({ code }) => {
				sent.push(code);
			}
		})
	);
	const post = (session: string, body: unknown) =>
		app.handle(
			new Request('http://localhost/auth/mfa/challenge', {
				body: JSON.stringify(body),
				headers: {
					'content-type': 'application/json',
					cookie: `user_session_id=${session}`
				},
				method: 'POST'
			})
		);

	return { first, post, second, secretA, secretB, sent };
};
test('selected authenticator is enforced and either person can sign in separately', async () => {
	const { post, first, second, secretA, secretB } = await fixture(0);
	expect(
		(
			await post(first, {
				code: await generateTotp({ secret: secretB }),
				factor: 'totp',
				factorId: 'totp-a'
			})
		).status
	).toBe(401);
	expect(
		(
			await post(first, {
				code: await generateTotp({ secret: secretA }),
				factor: 'totp',
				factorId: 'totp-a'
			})
		).status
	).toBe(200);
	expect(
		(
			await post(second, {
				code: await generateTotp({ secret: secretB }),
				factor: 'totp',
				factorId: 'totp-b'
			})
		).status
	).toBe(200);
});
test('SMS cooldown is isolated by phone and pending login', async () => {
	const { post, first, second } = await fixture(30000);
	expect(
		(
			await post(first, {
				action: 'send',
				factor: 'sms',
				factorId: 'phone-a'
			})
		).status
	).toBe(200);
	expect(
		(
			await post(second, {
				action: 'send',
				factor: 'sms',
				factorId: 'phone-b'
			})
		).status
	).toBe(200);
});
test('texts to two people can both be verified independently', async () => {
	const { post, first, second, sent } = await fixture(0);
	expect(
		(
			await post(first, {
				action: 'send',
				factor: 'sms',
				factorId: 'phone-a'
			})
		).status
	).toBe(200);
	expect(
		(
			await post(second, {
				action: 'send',
				factor: 'sms',
				factorId: 'phone-b'
			})
		).status
	).toBe(200);
	expect(
		(
			await post(first, {
				code: sent[0],
				factor: 'sms',
				factorId: 'phone-a'
			})
		).status
	).toBe(200);
	expect(
		(
			await post(second, {
				code: sent[1],
				factor: 'sms',
				factorId: 'phone-b'
			})
		).status
	).toBe(200);
});

test('two browsers using the same phone do not overwrite each others codes', async () => {
	const { post, first, second, sent } = await fixture(30000);
	expect(
		(
			await post(first, {
				action: 'send',
				factor: 'sms',
				factorId: 'phone-a'
			})
		).status
	).toBe(200);
	expect(
		(
			await post(second, {
				action: 'send',
				factor: 'sms',
				factorId: 'phone-a'
			})
		).status
	).toBe(200);
	expect(
		(
			await post(first, {
				code: sent[0],
				factor: 'sms',
				factorId: 'phone-a'
			})
		).status
	).toBe(200);
	expect(
		(
			await post(second, {
				code: sent[1],
				factor: 'sms',
				factorId: 'phone-a'
			})
		).status
	).toBe(200);
});
test('repeated sends on one selected phone return a usable cooldown', async () => {
	const { post, first } = await fixture(30000);
	await post(first, { action: 'send', factor: 'sms', factorId: 'phone-a' });
	const response = await post(first, {
		action: 'send',
		factor: 'sms',
		factorId: 'phone-a'
	});
	expect(response.status).toBe(429);
	expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
	expect((await response.json()).retryAfterMs).toBeGreaterThan(0);
	expect(
		(
			await post(first, {
				action: 'send',
				factor: 'sms',
				factorId: 'phone-b'
			})
		).status
	).toBe(200);
});

test('account delivery limit preserves issued codes and other methods', async () => {
	const { post, first, second, sent, secretB } = await fixture(0, 2);
	await post(first, { action: 'send', factor: 'sms', factorId: 'phone-a' });
	await post(first, { action: 'send', factor: 'sms', factorId: 'phone-b' });
	const limited = await post(second, {
		action: 'send',
		factor: 'sms',
		factorId: 'phone-a'
	});
	expect(limited.status).toBe(429);
	expect((await limited.json()).code).toBe('sms_delivery_rate_limited');
	expect(
		(
			await post(first, {
				code: sent[0],
				factor: 'sms',
				factorId: 'phone-a'
			})
		).status
	).toBe(200);
	expect(
		(
			await post(second, {
				code: await generateTotp({ secret: secretB }),
				factor: 'totp',
				factorId: 'totp-b'
			})
		).status
	).toBe(200);
});
