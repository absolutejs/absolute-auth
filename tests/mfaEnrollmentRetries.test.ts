import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mfaTotpRoutes } from '../src/mfa/totp';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { createInMemoryMfaStore } from '../src/mfa/inMemoryMfaStore';
import { generateTotp, hashToken } from '../src/crypto';
const fixture = async () => {
	const user = { email: 'audit@example.com', sub: 'audit-user' };
	const sessions = createInMemoryAuthSessionStore<typeof user>();
	const store = createInMemoryMfaStore();
	const id = crypto.randomUUID();
	await sessions.setSession(id, {
		accessToken: 'test',
		authenticatedAt: Date.now(),
		expiresAt: Date.now() + 60000,
		user
	});
	const app = new Elysia().use(
		mfaTotpRoutes({
			authSessionStore: sessions,
			issuer: 'onSpark',
			mfaStore: store,
			getUserId: (u) => u.sub
		})
	);
	const post = (path: string, body: unknown) =>
		app.handle(
			new Request(`http://localhost/auth/mfa/totp/${  path}`, {
				body: JSON.stringify(body),
				headers: {
					'content-type': 'application/json',
					cookie: `user_session_id=${id}`
				},
				method: 'POST'
			})
		);

	return { post, store, user };
};
test('repeated and concurrent verification replays the same recovery codes', async () => {
	const { post, store, user } = await fixture();
	const setup = await (await post('setup', { label: 'My phone' })).json();
	const body = {
		code: await generateTotp({ secret: setup.secret }),
		factorId: setup.factorId
	};
	const results = await Promise.all(
		Array.from({ length: 4 }, async () => {
			const response = await post('verify', body);
			expect(response.status).toBe(200);

			return response.json();
		})
	);
	expect(results[0].backupCodes.length).toBeGreaterThan(0);
	for (const result of results)
		expect(result.backupCodes).toEqual(results[0].backupCodes);
	expect((await store.getEnrollment(user.sub))?.backupCodeHashes).toContain(
		await hashToken(results[0].backupCodes[0])
	);
	expect(JSON.stringify(await store.getEnrollment(user.sub))).not.toContain(
		results[0].backupCodes[0]
	);
});
test('concurrent and reopened setup resumes the same pending QR', async () => {
	const { post } = await fixture();
	const setups = await Promise.all(
		Array.from({ length: 4 }, async () =>
			(await post('setup', { label: 'Personal phone' })).json()
		)
	);
	for (const setup of setups) expect(setup).toEqual(setups[0]);
	const reopened = await (
		await post('setup', { label: 'Different label' })
	).json();
	expect(reopened).toEqual(setups[0]);
	expect(decodeURIComponent(new URL(reopened.uri).pathname)).toContain(
		'Personal phone'
	);
	expect(
		(
			await post('verify', {
				code: await generateTotp({ secret: reopened.secret }),
				factorId: reopened.factorId
			})
		).status
	).toBe(200);
});
test('adding another device preserves saved recovery codes and has a distinct account label', async () => {
	const { post, store, user } = await fixture();
	const first = await (
		await post('setup', { label: 'Personal phone' })
	).json();
	const confirmed = await (
		await post('verify', {
			code: await generateTotp({ secret: first.secret }),
			factorId: first.factorId
		})
	).json();
	const second = await (await post('setup', { label: 'Work phone' })).json();
	expect(new URL(first.uri).pathname).not.toBe(new URL(second.uri).pathname);
	expect(decodeURIComponent(new URL(second.uri).pathname)).toContain(
		'Work phone'
	);
	const added = await (
		await post('verify', {
			code: await generateTotp({ secret: second.secret }),
			factorId: second.factorId
		})
	).json();
	expect(added.backupCodes).toEqual([]);
	expect((await store.getEnrollment(user.sub))?.backupCodeHashes).toContain(
		await hashToken(confirmed.backupCodes[0])
	);
});
test('receipt retry excludes consumed codes and expires without rotating hashes', async () => {
	const { post, store, user } = await fixture();
	const setup = await (await post('setup', {})).json();
	const body = {
		code: await generateTotp({ secret: setup.secret }),
		factorId: setup.factorId
	};
	const first = await (await post('verify', body)).json();
	await store.completeCodeChallenge({
		backupCodeHash: await hashToken(first.backupCodes[0]),
		now: Date.now(),
		userId: user.sub
	});
	const retry = await (await post('verify', body)).json();
	expect(retry.backupCodes).toEqual(first.backupCodes.slice(1));
	const current = await store.getEnrollment(user.sub);
 if (!current) throw new Error('Missing enrollment');
	await store.saveEnrollment({
		...current,
		factors: current.factors?.map((f) =>
			f.type === 'totp' ? { ...f, recoveryReceiptExpiresAt: 0 } : f
		)
	});
	expect(await (await post('verify', body)).json()).toEqual({
		backupCodes: []
	});
	expect((await store.getEnrollment(user.sub))?.backupCodeHashes).toEqual(
		current.backupCodeHashes
	);
});
