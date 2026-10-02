import { describe, test, expect } from 'bun:test';
import { Elysia, t } from 'elysia';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { createAccountSession as promoteToSession } from '../src/session/promote';
import { userSessionIdTypebox } from '../src/typebox';
import { runImport } from '../src/cli/import';
import { authenticateAccountPassword } from '../src/credentials/accounts';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { hashPassword } from '../src/crypto';

test('promotion revokes authenticated and pending sessions before issuing a new cookie', async () => {
	const previous = crypto.randomUUID();
	const sessions = createInMemoryAuthSessionStore<{ id: string }>();
	await sessions.setSession(previous, {
		expiresAt: Date.now() + 60000,
		user: { id: 'one' }
	});
	await sessions.setUnregisteredSession(previous, {
		expiresAt: Date.now() + 60000
	});
	const app = new Elysia().post(
		'/login',
		{ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) },
		async ({ cookie }) => {
			await promoteToSession({
				authSessionStore: sessions,
				cookie: cookie.user_session_id,
				inMemorySession: {},
				sessionDurationMs: 60000,
				user: { id: 'one' }
			});

			return 'ok';
		}
	);
	const response = await app.handle(
		new Request('http://localhost/login', {
			headers: { cookie: `user_session_id=${previous}` },
			method: 'POST'
		})
	);
	expect(response.status).toBe(200);
	expect(await sessions.getSession(previous)).toBeUndefined();
	expect(await sessions.getUnregisteredSession(previous)).toBeUndefined();
	expect(response.headers.get('set-cookie')).not.toContain(previous);
});

test('credential login resolves canonical ID even when profile email differs', async () => {
	const credentialStore = createInMemoryCredentialStore();
	await credentialStore.saveCredential({
		createdAt: 0,
		email: 'login@example.com',
		emailVerified: false,
		passwordHash: await hashPassword('password-long-enough'),
		status: 'active',
		updatedAt: 0,
		userId: 'stable-id'
	});
	const getUser = async (id: string) => ({
		email: 'contact@example.com',
		id
	});
	expect(
		await authenticateAccountPassword({
			credentialStore,
			email: ' LOGIN@example.com ',
			getUser,
			password: 'password-long-enough'
		})
	).toEqual({ email: 'contact@example.com', id: 'stable-id' });
	expect(
		await authenticateAccountPassword({
			credentialStore,
			email: 'contact@example.com',
			getUser,
			password: 'password-long-enough'
		})
	).toBeNull();
});

describe('application-owned import', () => {
	const result = {
		identities: [
			{
				authProvider: 'google',
				createdAtMs: 0,
				providerSubject: '123',
				userExternalId: 'original'
			}
		],
		source: 'test',
		users: [
			{
				createdAtMs: 0,
				email: 'one@example.com',
				emailVerified: true,
				externalId: 'original'
			}
		]
	};
	test('commit refuses guessed users schemas; dry-run does not connect', async () => {
		expect(
			await runImport(result, { commit: false, databaseUrl: 'unused' })
		).toEqual({ identityCount: 1, userCount: 1 });
		await expect(
			runImport(result, { commit: true, databaseUrl: 'unused' })
		).rejects.toThrow('require --writer');
	});
	test('adapter receives stable source IDs; orphan identities fail before writes', async () => {
		let calls = 0;
		const options = {
			commit: true,
			databaseUrl: 'unused',
			writer: async (input: typeof result) => {
				calls++;
				expect(input.users[0]?.externalId).toBe('original');

				return { identityCount: 1, userCount: 1 };
			}
		};
		await runImport(result, options);
		await expect(
			runImport({ ...result, users: [] }, options)
		).rejects.toThrow('unknown source user');
		expect(calls).toBe(1);
	});
});
