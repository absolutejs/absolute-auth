import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { CredentialsConfig } from '../src/credentials/config';
import { credentialsLogin } from '../src/credentials/login';
import { credentialsRegister } from '../src/credentials/register';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { isTrustedOrigin } from '../src/csrf';

type TestUser = { email: string; sub: string };

const post = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	body: unknown,
	headers: Record<string, string> = {}
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json', ...headers },
			method: 'POST'
		})
	);

describe('registration is enumeration-safe by default (F3B)', () => {
	const build = (overrides: Partial<CredentialsConfig<TestUser>> = {}) => {
		const users = new Map<string, TestUser>();
		const nudged: string[] = [];
		const config: CredentialsConfig<TestUser> = {
			credentialStore: createInMemoryCredentialStore(),
			passwordPolicy: { minLength: 8 },
			requireEmailVerification: true,
			getUserByEmail: (email) => users.get(email) ?? null,
			onCreateCredentialUser: ({ email }) => {
				const user = { email, sub: `s:${email}` };
				users.set(email, user);

				return user;
			},
			onExistingAccount: ({ email }) => {
				nudged.push(email);
			},
			onSendEmail: () => undefined,
			...overrides
		};

		return { app: new Elysia().use(credentialsRegister(config)), nudged };
	};

	test('a duplicate email does not 409 — same generic response + owner nudge', async () => {
		const { app, nudged } = build();
		const first = await post(app, '/auth/register', {
			email: 'a@b.com',
			password: 'password123'
		});
		expect(first.status).toBe(201);

		const dup = await post(app, '/auth/register', {
			email: 'a@b.com',
			password: 'password123'
		});
		expect(dup.status).toBe(first.status);
		expect(await dup.json()).toMatchObject({
			status: 'verification_required'
		});
		expect(nudged).toEqual(['a@b.com']);
	});

	test('revealRegistrationConflicts:true opts back into the 409', async () => {
		const { app } = build({ revealRegistrationConflicts: true });
		await post(app, '/auth/register', {
			email: 'a@b.com',
			password: 'password123'
		});
		const dup = await post(app, '/auth/register', {
			email: 'a@b.com',
			password: 'password123'
		});
		expect(dup.status).toBe(409);
	});
});

describe('origin CSRF check (F8c)', () => {
	const req = (origin?: string) =>
		new Request(
			'http://localhost/auth/login',
			origin === undefined ? {} : { headers: { origin } }
		);

	test('isTrustedOrigin: unconfigured allows, configured enforces', () => {
		expect(isTrustedOrigin(req('https://evil.com'))).toBe(true);
		expect(
			isTrustedOrigin(req('https://good.com'), ['https://good.com'])
		).toBe(true);
		expect(
			isTrustedOrigin(req('https://evil.com'), ['https://good.com'])
		).toBe(false);
		expect(isTrustedOrigin(req(undefined), ['https://good.com'])).toBe(
			false
		);
	});

	test('login rejects an untrusted Origin with 403, allows a trusted one', async () => {
		const config: CredentialsConfig<TestUser> = {
			credentialStore: createInMemoryCredentialStore(),
			passwordPolicy: { minLength: 8 },
			trustedOrigins: ['https://good.com'],
			getUserByEmail: () => null,
			onCreateCredentialUser: ({ email }) => ({ email, sub: 's' }),
			onSendEmail: () => undefined
		};
		const app = new Elysia().use(credentialsLogin(config));

		const blocked = await post(
			app,
			'/auth/login',
			{ email: 'a@b.com', password: 'whatever12' },
			{ origin: 'https://evil.com' }
		);
		expect(blocked.status).toBe(403);

		// A trusted origin passes the gate (then fails on credentials, 401).
		const allowed = await post(
			app,
			'/auth/login',
			{ email: 'a@b.com', password: 'whatever12' },
			{ origin: 'https://good.com' }
		);
		expect(allowed.status).not.toBe(403);
	});
});
