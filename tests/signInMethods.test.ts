import { describe, expect, test } from 'bun:test';
import type { OAuth2TokenResponse } from 'citra';
import { Elysia } from 'elysia';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { AuthIdentityConflictError } from '../src/errors';
import { createInMemoryIdentityStore } from '../src/identities/inMemoryIdentityStore';
import { resolveCallbackIdentity } from '../src/identities/link';
import { auth } from '../src/index';
import { getUserSessionId } from '../src/utils';
import { blockMigrations } from '../src/migrations';
import { describeUserAgent } from '../src/session/device';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import type { WebAuthnAdapter } from '../src/webauthn/adapter';
import { createInMemoryWebAuthnCredentialStore } from '../src/webauthn/inMemoryWebAuthnCredentialStore';

type TestUser = { email: string; sub: string };

const ICLOUD = 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd';
const CHROME_WINDOWS =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const THIRTY_DAYS_MS = 2_592_000_000;
let nextCredential = 0;
const readAaguid = (response: unknown) => {
	const value: unknown =
		response && typeof response === 'object'
			? Reflect.get(response, 'aaguid')
			: undefined;

	return typeof value === 'string' ? value : undefined;
};
const adapter: WebAuthnAdapter = {
	createAuthenticationOptions: () => ({ challenge: 'a', options: {} }),
	createRegistrationOptions: () => ({ challenge: 'r', options: {} }),
	verifyAuthentication: async () => ({ verified: true }),
	verifyRegistration: async ({ response }) => {
		nextCredential += 1;

		return {
			credential: {
				aaguid: readAaguid(response),
				backedUp: true,
				counter: 0,
				credentialId: `cred-${nextCredential}`,
				publicKey: `key-${nextCredential}`
			},
			verified: true
		};
	}
};

const build = async ({ otherWayIn = false, persistent = false } = {}) => {
	const users = new Map<string, TestUser>();
	const identityStore = createInMemoryIdentityStore();
	const passkeys = createInMemoryWebAuthnCredentialStore();
	const instance = await auth<TestUser>({
		authSessionStore: createInMemoryAuthSessionStore<TestUser>(),
		credentials: {
			credentialStore: createInMemoryCredentialStore(),
			passwordPolicy: { minLength: 8 },
			getUserByEmail: (email) => users.get(email) ?? null,
			onCreateCredentialUser: ({ email }) => {
				const user = { email, sub: `user:${email}` };
				users.set(email, user);

				return user;
			},
			onSendEmail: () => undefined
		},
		identities: {
			identityStore,
			getUserId: (user) => user.sub,
			hasOtherSignInMethod: () => otherWayIn
		},
		providersConfiguration: {},
		sessions: { getUserId: (user) => user.sub },
		webauthn: {
			credentialStore: passkeys,
			origin: 'https://localhost',
			persistentSessionCookie: persistent,
			rpId: 'localhost',
			rpName: 'Test',
			sessionDurationMs: THIRTY_DAYS_MS,
			webauthnAdapter: adapter,
			getUserId: (user) => user.sub,
			getWebAuthnUser: (id) =>
				[...users.values()].find((user) => user.sub === id) ?? null,
			hasOtherSignInMethod: () => otherWayIn
		}
	});

	return { app: new Elysia().use(instance), identityStore, passkeys };
};

type App = Awaited<ReturnType<typeof build>>['app'];

const call = (
	app: App,
	method: string,
	path: string,
	cookie?: string,
	body?: unknown
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: body === undefined ? undefined : JSON.stringify(body),
			headers: {
				'user-agent': CHROME_WINDOWS,
				...(body === undefined
					? {}
					: { 'content-type': 'application/json' }),
				...(cookie ? { cookie } : {})
			},
			method
		})
	);

const cookieNamed = (response: Response, name: string) =>
	response.headers
		.getSetCookie()
		.find((value) => value.startsWith(`${name}=`))
		?.split(';')[0] ?? '';

const signUp = async (app: App, email: string) =>
	cookieNamed(
		await call(app, 'POST', '/auth/register', undefined, {
			email,
			password: 'supersecret'
		}),
		'user_session_id'
	);

const addPasskey = async (app: App, session: string, body: object) => {
	const options = await call(
		app,
		'POST',
		'/auth/webauthn/register/options',
		session,
		{}
	);
	const challenge = cookieNamed(options, 'webauthn_challenge');

	return call(
		app,
		'POST',
		'/auth/webauthn/register/verify',
		`${session}; ${challenge}`,
		{ id: 'x', ...body }
	);
};

describe('passkey management', () => {
	test('names passkeys after their provider or the name given', async () => {
		const { app } = await build();
		const session = await signUp(app, 'a@example.com');
		await addPasskey(app, session, { aaguid: ICLOUD });
		await addPasskey(app, session, { name: '  Work   laptop ' });

		const list = await call(
			app,
			'GET',
			'/auth/webauthn/credentials',
			session
		);
		const names = (await list.json()).credentials.map(
			(credential: { name: string }) => credential.name
		);
		expect(names.sort()).toEqual(['Work laptop', 'iCloud Keychain']);
	});

	test('renames and removes only the owner’s passkeys', async () => {
		const { app, passkeys } = await build({ otherWayIn: true });
		const owner = await signUp(app, 'owner@example.com');
		const stranger = await signUp(app, 'stranger@example.com');
		const created = await (await addPasskey(app, owner, {})).json();
		const path = `/auth/webauthn/credentials/${created.credentialId}`;

		expect(
			(await call(app, 'PATCH', path, stranger, { name: 'Mine' })).status
		).toBe(404);
		expect((await call(app, 'DELETE', path, stranger)).status).toBe(404);

		const renamed = await call(app, 'PATCH', path, owner, {
			name: 'Phone'
		});
		expect(renamed.status).toBe(200);
		expect((await passkeys.getCredential(created.credentialId))?.name).toBe(
			'Phone'
		);
		expect((await call(app, 'DELETE', path, owner)).status).toBe(200);
		expect(
			await passkeys.getCredential(created.credentialId)
		).toBeUndefined();
	});

	test('keeps the last passkey when there is no other way in', async () => {
		const { app } = await build({ otherWayIn: false });
		const session = await signUp(app, 'solo@example.com');
		const { credentialId } = await (
			await addPasskey(app, session, {})
		).json();

		const response = await call(
			app,
			'DELETE',
			`/auth/webauthn/credentials/${credentialId}`,
			session
		);
		expect(response.status).toBe(409);
	});
});

describe('session devices', () => {
	test('lists how and where each session signed in', async () => {
		const { app } = await build();
		const session = await signUp(app, 'dev@example.com');
		const response = await call(app, 'GET', '/auth/sessions', session);
		const [entry] = (await response.json()).sessions;
		expect(entry?.signInMethod).toBe('password');
		expect(entry?.device).toEqual({ browser: 'Chrome', os: 'Windows' });
	});

	test('reads common browsers', () => {
		expect(
			describeUserAgent(
				'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
			)
		).toEqual({ browser: 'Safari', os: 'iOS' });
		expect(
			describeUserAgent(
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
			)
		).toEqual({ browser: 'Edge', os: 'macOS' });
		expect(describeUserAgent(undefined)).toBeUndefined();
	});
});

describe('sign-in identities', () => {
	test('one provider account belongs to one user', async () => {
		const store = createInMemoryIdentityStore();
		const first = await store.linkIdentity({
			provider: 'google',
			providerSubject: '123',
			userId: 'u1'
		});
		expect(first.status).toBe('linked');
		expect(first.identity.id).toBe('google:123');
		expect(
			(
				await store.linkIdentity({
					provider: 'google',
					providerSubject: '123',
					userId: 'u1'
				})
			).status
		).toBe('already_linked');
		expect(
			store.linkIdentity({
				provider: 'google',
				providerSubject: '123',
				userId: 'u2'
			})
		).rejects.toBeInstanceOf(AuthIdentityConflictError);
	});

	test('lists and unlinks, never the last way in', async () => {
		const { app, identityStore } = await build({ otherWayIn: false });
		const session = await signUp(app, 'multi@example.com');
		const userId = 'user:multi@example.com';
		await identityStore.linkIdentity({
			metadata: { email: 'multi@example.com' },
			provider: 'google',
			providerSubject: 'g1',
			userId
		});
		await identityStore.linkIdentity({
			provider: 'microsoftentraid',
			providerSubject: 'm1',
			userId
		});
		await identityStore.linkIdentity({
			provider: 'github',
			providerSubject: 'someone-else',
			userId: 'user:other'
		});

		const listed = await (
			await call(app, 'GET', '/auth/identities', session)
		).json();
		expect(
			listed.identities.map((identity: { id: string }) => identity.id)
		).toEqual(['google:g1', 'microsoftentraid:m1']);
		expect(listed.identities[0]?.email).toBe('multi@example.com');

		expect(
			(
				await call(
					app,
					'DELETE',
					'/auth/identities/github:someone-else',
					session
				)
			).status
		).toBe(404);
		expect(
			(
				await call(
					app,
					'DELETE',
					'/auth/identities/microsoftentraid:m1',
					session
				)
			).status
		).toBe(200);
		expect(
			(await call(app, 'DELETE', '/auth/identities/google:g1', session))
				.status
		).toBe(409);
	});

	test('reads the provider account from a callback', async () => {
		const payload = Buffer.from(
			JSON.stringify({
				email: 'person@example.com',
				email_verified: true,
				name: 'Person',
				sub: 'google-subject'
			})
		).toString('base64url');
		const tokenResponse: OAuth2TokenResponse = {
			access_token: 'token',
			id_token: `e30.${payload}.sig`,
			token_type: 'Bearer'
		};
		const resolved = await resolveCallbackIdentity({
			authProvider: 'google',
			providerInstance: { fetchUserProfile: async () => ({}) },
			tokenResponse
		});
		expect(resolved.providerSubject).toBe('google-subject');
		expect(resolved.metadata).toEqual({
			email: 'person@example.com',
			name: 'Person'
		});
	});

	test('migrations add identities, passkey names and session devices', () => {
		const sql = (block: keyof typeof blockMigrations) =>
			blockMigrations[block].migrations
				.map((migration) => migration.sql)
				.join('\n');
		expect(sql('identities')).toContain(
			'auth_identities_provider_subject_idx'
		);
		expect(sql('webauthn')).toContain('"name" varchar(100)');
		expect(sql('sessions')).toContain('"user_agent" varchar(512)');
	});
});

describe('persistent session cookies', () => {
	const signInWithPasskey = async (persistent: boolean) => {
		const { app } = await build({ persistent });
		const session = await signUp(app, `keep-${persistent}@example.com`);
		const { credentialId } = await (
			await addPasskey(app, session, {})
		).json();
		const options = await call(
			app,
			'POST',
			'/auth/webauthn/authenticate/options',
			undefined,
			{}
		);
		const challenge = cookieNamed(options, 'webauthn_challenge');
		const verified = await call(
			app,
			'POST',
			'/auth/webauthn/authenticate/verify',
			challenge,
			{ id: credentialId }
		);

		return verified.headers
			.getSetCookie()
			.find((value) => value.startsWith('user_session_id='));
	};

	test('a passkey sign-in keeps its cookie for the session length when asked', async () => {
		expect(await signInWithPasskey(true)).toContain('Max-Age=2592000');
	});

	test('otherwise the cookie ends with the browser', async () => {
		expect(await signInWithPasskey(false)).not.toContain('Max-Age');
	});

	test('instantiated sessions can keep their cookie too', async () => {
		const app = new Elysia().get('/', ({ cookie: { user_session_id } }) => {
			getUserSessionId({ maxAgeSeconds: 2_592_000, user_session_id });

			return 'ok';
		});
		const response = await app.handle(new Request('http://localhost/'));
		expect(response.headers.getSetCookie()[0]).toContain('Max-Age=2592000');
	});
});

describe('form_post callbacks', () => {
	test('a provider POST becomes a same-site GET with only OAuth fields', async () => {
		const { app } = await build();
		const response = await app.handle(
			new Request('http://localhost/oauth2/callback', {
				body: new URLSearchParams({
					code: 'the-code',
					extra: 'dropped',
					state: 'the-state',
					user: '{"name":{"firstName":"Ada"}}'
				}),
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST'
			})
		);
		expect(response.status).toBe(303);
		const location = new URL(
			response.headers.get('location') ?? '',
			'http://localhost'
		);
		expect(location.pathname).toBe('/oauth2/callback');
		expect(location.searchParams.get('code')).toBe('the-code');
		expect(location.searchParams.get('state')).toBe('the-state');
		expect(location.searchParams.get('user')).toContain('Ada');
		expect(location.searchParams.has('extra')).toBe(false);
	});
});
