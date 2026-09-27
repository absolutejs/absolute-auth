/** Runs the code in docs/PERSISTENT-CREDENTIALS.md, extracted verbatim (only the
 * package imports point at src), through register, login, a protected route and
 * sign-out. SQLite always runs; Postgres runs when AUTH_POSTGRES_TEST_URL is set.
 * `bun run check:guide` typechecks the same blocks against the built dist. */
import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
	guideWorkDirectory,
	readGuideExamples,
	SOURCE_ENTRY_POINTS,
	writeGuideExamples
} from '../scripts/guideExamples';

type GuideApp = { handle: (request: Request) => Promise<Response> };

const postgresUrl = process.env['AUTH_POSTGRES_TEST_URL'];
const directory = guideWorkDirectory(`runtime-${crypto.randomUUID()}`);
const examples = await readGuideExamples();
await writeGuideExamples(directory, examples, SOURCE_ENTRY_POINTS);

afterAll(async () => {
	await rm(directory, { force: true, recursive: true });
});

const isGuideApp = (value: unknown): value is GuideApp =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'handle') === 'function';

const loadApp = async (file: string) => {
	const loaded: unknown = await import(join(directory, file));
	const app: unknown =
		typeof loaded === 'object' && loaded !== null
			? Reflect.get(loaded, 'app')
			: undefined;
	if (!isGuideApp(app)) throw new Error(`${file} does not export an app`);

	return app;
};

const sessionCookie = (response: Response) => {
	const header = response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith('user_session_id='));

	return header?.split(';')[0];
};

const runGuideFlow = async (app: GuideApp) => {
	const call = (
		method: string,
		path: string,
		{ body, cookie }: { body?: object; cookie?: string } = {}
	) => {
		const headers = new Headers();
		if (body) headers.set('content-type', 'application/json');
		if (cookie) headers.set('cookie', cookie);

		return app.handle(
			new Request(`http://localhost${path}`, {
				body: body ? JSON.stringify(body) : undefined,
				headers,
				method
			})
		);
	};
	const email = `guide-${crypto.randomUUID()}@example.com`;
	const password = 'correct horse battery staple';

	expect((await call('GET', '/api/me')).status).toBe(401);

	const registered = await call('POST', '/auth/register', {
		body: { email, password }
	});
	expect(registered.status).toBe(201);
	expect(await registered.json()).toEqual({ status: 'authenticated' });
	const registeredCookie = sessionCookie(registered);
	expect(registeredCookie).toBeDefined();

	const wrongPassword = await call('POST', '/auth/login', {
		body: { email, password: 'not the password at all' }
	});
	expect(wrongPassword.status).toBe(401);

	const loggedIn = await call('POST', '/auth/login', {
		body: { email, password }
	});
	expect(loggedIn.status).toBe(200);
	expect(await loggedIn.json()).toMatchObject({ status: 'authenticated' });
	const cookie = sessionCookie(loggedIn);
	if (!cookie) throw new Error('Login set no user_session_id cookie');

	const account = await call('GET', '/api/me', { cookie });
	expect(account.status).toBe(200);
	const { user }: { user: unknown } = await account.json();
	expect(user).toMatchObject({ email });

	const signedOut = await call('DELETE', '/oauth2/signout', { cookie });
	expect(signedOut.status).toBe(204);
	expect(sessionCookie(signedOut)).toBe('user_session_id=');
	expect((await call('GET', '/api/me', { cookie })).status).toBe(401);
	// The registration session is independent and still valid.
	expect(
		(await call('GET', '/api/me', { cookie: registeredCookie })).status
	).toBe(200);
};

test('the SQLite guide path signs up, signs in, guards and signs out', async () => {
	await mkdir(join(directory, 'sqlite-data'), { recursive: true });
	process.env['SQLITE_PATH'] = join(directory, 'sqlite-data/app.sqlite');
	await runGuideFlow(await loadApp('sqlite/app.ts'));
});

test.skipIf(!postgresUrl)(
	'the Postgres guide path signs up, signs in, guards and signs out',
	async () => {
		if (!postgresUrl) throw new Error('AUTH_POSTGRES_TEST_URL is required');
		// The guide leaves the app-owned users table to the app's own Drizzle
		// migrations; create the equivalent here.
		const client = new SQL({ max: 1, url: postgresUrl });
		await client`CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, email text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now())`;
		await client.close();
		process.env['DATABASE_URL'] = postgresUrl;
		await runGuideFlow(await loadApp('postgres/app.ts'));
	}
);
