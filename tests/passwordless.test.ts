import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { auth } from '../src/index';
import type {
	MagicLinkMessage,
	PasswordlessOtpMessage
} from '../src/passwordless/config';
import { createInMemoryPasswordlessTokenStore } from '../src/passwordless/inMemoryPasswordlessTokenStore';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

type TestUser = {
	email: string;
	sub: string;
};

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;

const buildApp = async () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const passwordlessTokenStore = createInMemoryPasswordlessTokenStore();
	const users = new Map<string, TestUser>();
	const links: MagicLinkMessage[] = [];
	const codes: PasswordlessOtpMessage[] = [];
	const authInstance = await auth<TestUser>({
		authSessionStore,
		passwordless: {
			passwordlessTokenStore,
			getUserByEmail: (email) => users.get(email) ?? null,
			getUserId: (user) => user.sub,
			onCreateUser: ({ email }) => {
				const user: TestUser = { email, sub: `user:${email}` };
				users.set(email, user);

				return user;
			},
			onSendMagicLink: (message) => {
				links.push(message);
			},
			onSendOtp: (message) => {
				codes.push(message);
			}
		},
		providersConfiguration: {}
	});

	return { app: new Elysia().use(authInstance), codes, links };
};

const post = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	body: unknown
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		})
	);

const sessionCookie = (response: Response) =>
	response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith('user_session_id='))
		?.split(';')[0] ?? '';

describe('passwordless magic links', () => {
	test('request → verify signs the user in (creating on first login)', async () => {
		const { app, links } = await buildApp();

		const requested = await post(app, '/auth/passwordless/magic-link', {
			email: 'new@example.com'
		});
		expect(requested.status).toBe(HTTP_OK);
		expect(links).toHaveLength(1);

		const verified = await post(
			app,
			'/auth/passwordless/magic-link/verify',
			{ token: links[0]?.token ?? '' }
		);

		expect(verified.status).toBe(HTTP_OK);
		expect((await verified.json()).status).toBe('authenticated');
		expect(sessionCookie(verified)).toContain('user_session_id=');
	});

	test('a magic-link token is single-use', async () => {
		const { app, links } = await buildApp();
		await post(app, '/auth/passwordless/magic-link', {
			email: 'once@example.com'
		});
		const token = links[0]?.token ?? '';

		expect(
			(await post(app, '/auth/passwordless/magic-link/verify', { token }))
				.status
		).toBe(HTTP_OK);
		expect(
			(await post(app, '/auth/passwordless/magic-link/verify', { token }))
				.status
		).toBe(HTTP_BAD_REQUEST);
	});
});

describe('passwordless OTP', () => {
	test('request → verify with the emailed code signs the user in', async () => {
		const { app, codes } = await buildApp();

		await post(app, '/auth/passwordless/otp', { email: 'otp@example.com' });
		expect(codes).toHaveLength(1);

		const verified = await post(app, '/auth/passwordless/otp/verify', {
			code: codes[0]?.code ?? '',
			email: 'otp@example.com'
		});

		expect(verified.status).toBe(HTTP_OK);
		expect(sessionCookie(verified)).toContain('user_session_id=');
	});

	test('a wrong OTP code is rejected', async () => {
		const { app, codes } = await buildApp();
		await post(app, '/auth/passwordless/otp', {
			email: 'otp2@example.com'
		});
		const real = codes[0]?.code ?? '';
		const wrong = real === '111111' ? '222222' : '111111';

		const verified = await post(app, '/auth/passwordless/otp/verify', {
			code: wrong,
			email: 'otp2@example.com'
		});

		expect(verified.status).toBe(HTTP_BAD_REQUEST);
	});
});
