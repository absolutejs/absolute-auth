import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { generateTotp } from '../src/crypto';
import type { CredentialEmailMessage } from '../src/credentials/config';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { auth } from '../src/index';
import { createInMemoryMfaStore } from '../src/mfa/inMemoryMfaStore';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

type TestUser = {
	email: string;
	sub: string;
};

const buildMfaApp = async ({
	totpMaxAttempts
}: { totpMaxAttempts?: number } = {}) => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const credentialStore = createInMemoryCredentialStore();
	const mfaStore = createInMemoryMfaStore();
	const users = new Map<string, TestUser>();
	const sent: CredentialEmailMessage[] = [];
	const getUserByEmail = (email: string) => users.get(email) ?? null;

	const authInstance = await auth<TestUser>({
		authSessionStore,
		credentials: {
			credentialStore,
			getUserByEmail,
			passwordPolicy: { minLength: 8 },
			onCreateCredentialUser: ({ email }) => {
				const user: TestUser = { email, sub: `user:${email}` };
				users.set(email, user);

				return user;
			},
			onSendEmail: (message) => {
				sent.push(message);
			}
		},
		mfa: {
			mfaStore,
			totpMaxAttempts,
			getChallengeUser: (identity) =>
				getUserByEmail(
					typeof identity.email === 'string' ? identity.email : ''
				),
			getUserId: (user) => user.sub
		},
		providersConfiguration: {}
	});

	const app = new Elysia()
		.use(authInstance)
		.get('/me', ({ protectRoute }) => protectRoute((user) => ({ user })));

	return { app };
};

const post = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	body: unknown,
	cookie?: string
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: JSON.stringify(body),
			headers:
				cookie === undefined
					? { 'content-type': 'application/json' }
					: { 'content-type': 'application/json', cookie },
			method: 'POST'
		})
	);

const cookieFrom = (response: Response) =>
	response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith('user_session_id='))
		?.split(';')[0] ?? '';

const enroll = async (app: {
	handle: (request: Request) => Promise<Response>;
}) => {
	const registered = await post(app, '/auth/register', {
		email: 'flow@example.com',
		password: 'supersecret'
	});
	const sessionCookie = cookieFrom(registered);

	const setup = await (
		await post(app, '/auth/mfa/totp/setup', {}, sessionCookie)
	).json();
	const verified = await (
		await post(
			app,
			'/auth/mfa/totp/verify',
			{ code: await generateTotp({ secret: setup.secret }) },
			sessionCookie
		)
	).json();

	return { backupCodes: verified.backupCodes, secret: setup.secret };
};

describe('MFA challenge integration', () => {
	test('an enrolled user must pass a TOTP challenge to get a session', async () => {
		const { app } = await buildMfaApp();
		const { secret } = await enroll(app);

		const login = await post(app, '/auth/login', {
			email: 'flow@example.com',
			password: 'supersecret'
		});
		expect(login.status).toBe(200);
		expect(await login.json()).toMatchObject({ status: 'mfa_required' });
		const pending = cookieFrom(login);

		const wrong = await post(
			app,
			'/auth/mfa/challenge',
			{ code: '000000' },
			pending
		);
		expect(wrong.status).toBe(401);

		const challenged = await post(
			app,
			'/auth/mfa/challenge',
			{ code: await generateTotp({ secret }) },
			pending
		);
		expect(challenged.status).toBe(200);

		const meResponse = await app.handle(
			new Request('http://localhost/me', {
				headers: { cookie: cookieFrom(challenged) }
			})
		);
		expect(meResponse.status).toBe(200);
		expect(await meResponse.json()).toMatchObject({
			user: { email: 'flow@example.com' }
		});
	});

	test('a backup code also satisfies the challenge', async () => {
		const { app } = await buildMfaApp();
		const { backupCodes } = await enroll(app);

		const login = await post(app, '/auth/login', {
			email: 'flow@example.com',
			password: 'supersecret'
		});
		const pending = cookieFrom(login);

		const challenged = await post(
			app,
			'/auth/mfa/challenge',
			{ code: backupCodes[0] },
			pending
		);
		expect(challenged.status).toBe(200);
	});

	test('the TOTP challenge locks out after too many failed attempts', async () => {
		const { app } = await buildMfaApp({ totpMaxAttempts: 3 });
		const { secret } = await enroll(app);

		const login = await post(app, '/auth/login', {
			email: 'flow@example.com',
			password: 'supersecret'
		});
		const pending = cookieFrom(login);

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const wrong = await post(
				app,
				'/auth/mfa/challenge',
				{ code: '000000' },
				pending
			);
			expect(wrong.status).toBe(401);
			expect(await wrong.text()).toContain('Invalid MFA code');
		}

		// A valid code is now rejected: the lockout gates before verification.
		const lockedOut = await post(
			app,
			'/auth/mfa/challenge',
			{ code: await generateTotp({ secret }) },
			pending
		);
		expect(lockedOut.status).toBe(401);
		expect(await lockedOut.text()).toContain('Too many attempts');
	});

	test('a successful challenge resets the TOTP failed-attempt counter', async () => {
		const { app } = await buildMfaApp({ totpMaxAttempts: 3 });
		const { secret } = await enroll(app);

		const firstLogin = await post(app, '/auth/login', {
			email: 'flow@example.com',
			password: 'supersecret'
		});
		const firstPending = cookieFrom(firstLogin);

		// Two failures, then a success — the counter must be back at 0 afterwards.
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await post(
				app,
				'/auth/mfa/challenge',
				{ code: '000000' },
				firstPending
			);
		}
		const recovered = await post(
			app,
			'/auth/mfa/challenge',
			{ code: await generateTotp({ secret }) },
			firstPending
		);
		expect(recovered.status).toBe(200);

		// Fresh login: two more failures should NOT trip the lockout if the reset worked.
		const secondLogin = await post(app, '/auth/login', {
			email: 'flow@example.com',
			password: 'supersecret'
		});
		const secondPending = cookieFrom(secondLogin);
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const wrong = await post(
				app,
				'/auth/mfa/challenge',
				{ code: '000000' },
				secondPending
			);
			expect(await wrong.text()).toContain('Invalid MFA code');
		}
	});
});
