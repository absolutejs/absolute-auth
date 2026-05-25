import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { WebAuthnAdapter } from '../src/webauthn/adapter';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { auth } from '../src/index';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { createInMemoryWebAuthnCredentialStore } from '../src/webauthn/inMemoryWebAuthnCredentialStore';

type TestUser = {
	email: string;
	sub: string;
};

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const REG_CHALLENGE = 'reg-challenge';
const AUTH_CHALLENGE = 'auth-challenge';
const SEED_COUNTER = 5;

const fakeWebAuthnAdapter: WebAuthnAdapter = {
	createAuthenticationOptions: () =>
		Promise.resolve({
			challenge: AUTH_CHALLENGE,
			options: { challenge: AUTH_CHALLENGE }
		}),
	createRegistrationOptions: ({ userId }) => ({
		challenge: REG_CHALLENGE,
		options: { challenge: REG_CHALLENGE, user: { id: userId } }
	}),
	verifyAuthentication: ({ credential, expectedChallenge }) =>
		Promise.resolve({
			newCounter: credential.counter + 1,
			verified: expectedChallenge === AUTH_CHALLENGE
		}),
	verifyRegistration: ({ expectedChallenge }) =>
		Promise.resolve({
			credential: {
				counter: 0,
				credentialId: 'cred-1',
				publicKey: 'pubkey-1',
				transports: ['internal']
			},
			verified: expectedChallenge === REG_CHALLENGE
		})
};

const buildApp = async () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const credentialStore = createInMemoryCredentialStore();
	const webauthnCredentialStore = createInMemoryWebAuthnCredentialStore();
	const users = new Map<string, TestUser>();
	const authInstance = await auth<TestUser>({
		authSessionStore,
		credentials: {
			credentialStore,
			passwordPolicy: { minLength: 8 },
			getUserByEmail: (email) => users.get(email) ?? null,
			onCreateCredentialUser: ({ email }) => {
				const user: TestUser = { email, sub: `user:${email}` };
				users.set(email, user);

				return user;
			},
			onSendEmail: () => undefined
		},
		providersConfiguration: {},
		webauthn: {
			credentialStore: webauthnCredentialStore,
			origin: 'https://localhost',
			rpId: 'localhost',
			rpName: 'Test',
			webauthnAdapter: fakeWebAuthnAdapter,
			getUserId: (user) => user.sub,
			getWebAuthnUser: (userId) =>
				[...users.values()].find((user) => user.sub === userId) ?? null
		}
	});

	return { app: new Elysia().use(authInstance), webauthnCredentialStore };
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

const namedCookie = (response: Response, name: string) =>
	response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith(`${name}=`))
		?.split(';')[0] ?? '';

const registerUser = async (
	app: { handle: (request: Request) => Promise<Response> },
	email: string
) =>
	namedCookie(
		await post(app, '/auth/register', { email, password: 'supersecret' }),
		'user_session_id'
	);

describe('WebAuthn registration', () => {
	test('registers a passkey for the authenticated caller', async () => {
		const { app, webauthnCredentialStore } = await buildApp();
		const sessionCookie = await registerUser(app, 'pk@example.com');

		const options = await post(
			app,
			'/auth/webauthn/register/options',
			{},
			sessionCookie
		);
		expect(options.status).toBe(HTTP_OK);
		const challengeCookie = namedCookie(options, 'webauthn_challenge');
		expect(challengeCookie).toContain(REG_CHALLENGE);

		const verified = await post(
			app,
			'/auth/webauthn/register/verify',
			{ id: 'cred-1' },
			`${sessionCookie}; ${challengeCookie}`
		);
		expect(verified.status).toBe(HTTP_OK);
		expect((await verified.json()).credentialId).toBe('cred-1');

		const stored = await webauthnCredentialStore.getCredential('cred-1');
		expect(stored?.userId).toBe('user:pk@example.com');
	});

	test('register/options requires an authenticated session', async () => {
		const { app } = await buildApp();

		const response = await post(app, '/auth/webauthn/register/options', {});

		expect(response.status).toBe(HTTP_UNAUTHORIZED);
	});

	test('register/verify rejects a missing challenge', async () => {
		const { app } = await buildApp();
		const sessionCookie = await registerUser(app, 'nochal@example.com');

		const response = await post(
			app,
			'/auth/webauthn/register/verify',
			{ id: 'cred-1' },
			sessionCookie
		);

		expect(response.status).toBe(HTTP_BAD_REQUEST);
	});
});

describe('WebAuthn authentication', () => {
	test('signs in passwordlessly and bumps the signature counter', async () => {
		const { app, webauthnCredentialStore } = await buildApp();
		// Register the user so getWebAuthnUser can resolve the credential's userId.
		await registerUser(app, 'login@example.com');
		await webauthnCredentialStore.saveCredential({
			counter: SEED_COUNTER,
			createdAt: Date.now(),
			credentialId: 'cred-1',
			publicKey: 'pubkey-1',
			userId: 'user:login@example.com'
		});

		const options = await post(
			app,
			'/auth/webauthn/authenticate/options',
			{}
		);
		const challengeCookie = namedCookie(options, 'webauthn_challenge');

		const verified = await post(
			app,
			'/auth/webauthn/authenticate/verify',
			{ id: 'cred-1' },
			challengeCookie
		);

		expect(verified.status).toBe(HTTP_OK);
		expect((await verified.json()).status).toBe('authenticated');
		expect(namedCookie(verified, 'user_session_id')).toContain(
			'user_session_id='
		);
		const stored = await webauthnCredentialStore.getCredential('cred-1');
		expect(stored?.counter).toBe(SEED_COUNTER + 1);
	});

	test('rejects an unknown credential', async () => {
		const { app } = await buildApp();

		const options = await post(
			app,
			'/auth/webauthn/authenticate/options',
			{}
		);
		const challengeCookie = namedCookie(options, 'webauthn_challenge');

		const response = await post(
			app,
			'/auth/webauthn/authenticate/verify',
			{ id: 'ghost' },
			challengeCookie
		);

		expect(response.status).toBe(HTTP_UNAUTHORIZED);
	});
});
