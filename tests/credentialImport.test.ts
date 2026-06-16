import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { hashPassword } from '../src/crypto';
import { auth } from '../src/index';
import {
	importUser,
	importUsers,
	rehashCredentialPassword
} from '../src/credentials/import';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import {
	isLegacyHash,
	verifyAuth0Pbkdf2,
	verifyCognitoSha256
} from '../src/credentials/legacyHashers';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

type TestUser = { email: string; sub: string };

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const PBKDF2_ITERATIONS = 100_000;

// Helpers to produce wrapped-format hashes the legacy verifiers accept.
const buildAuth0Pbkdf2Hash = async (password: string, salt: Uint8Array) => {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		{ name: 'PBKDF2' },
		false,
		['deriveBits']
	);
	const derived = await crypto.subtle.deriveBits(
		{
			hash: 'SHA-256',
			iterations: PBKDF2_ITERATIONS,
			name: 'PBKDF2',
			salt
		},
		key,
		256
	);

	return `auth0_pbkdf2:${Buffer.from(salt).toString('base64')}:${Buffer.from(
		new Uint8Array(derived)
	).toString('base64')}:${PBKDF2_ITERATIONS}`;
};

const buildCognitoSha256Hash = async (password: string, salt: Uint8Array) => {
	const payload = new Uint8Array(salt.byteLength + password.length);
	payload.set(salt, 0);
	payload.set(new TextEncoder().encode(password), salt.byteLength);
	const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', payload));

	return `cognito_sha256:${Buffer.from(salt).toString('base64')}:${Buffer.from(
		hash
	).toString('base64')}`;
};

describe('legacy hash verifiers', () => {
	test('verifyAuth0Pbkdf2 round-trips for the correct password', async () => {
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const wrapped = await buildAuth0Pbkdf2Hash('s3cret', salt);
		expect(await verifyAuth0Pbkdf2('s3cret', wrapped)).toBe(true);
		expect(await verifyAuth0Pbkdf2('wrong', wrapped)).toBe(false);
	});

	test('verifyCognitoSha256 round-trips', async () => {
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const wrapped = await buildCognitoSha256Hash('s3cret', salt);
		expect(await verifyCognitoSha256('s3cret', wrapped)).toBe(true);
		expect(await verifyCognitoSha256('wrong', wrapped)).toBe(false);
	});

	test('rejects malformed wrappers', async () => {
		expect(await verifyAuth0Pbkdf2('s3cret', 'not_a_wrapped_hash')).toBe(
			false
		);
		expect(
			await verifyCognitoSha256('s3cret', 'cognito_sha256:onlytwoparts')
		).toBe(false);
	});

	test('isLegacyHash identifies non-native formats', () => {
		expect(isLegacyHash('auth0_pbkdf2:...')).toBe(true);
		expect(isLegacyHash('cognito_sha256:...')).toBe(true);
		expect(isLegacyHash('$argon2id$v=19$m=65536$abc')).toBe(false);
		expect(isLegacyHash('$2b$10$abcdefg')).toBe(false);
		expect(isLegacyHash('$2a$12$abcdefg')).toBe(false);
	});
});

describe('importUsers orchestration', () => {
	test('imports a batch + reports per-user success/failure', async () => {
		const credentialStore = createInMemoryCredentialStore();
		const users = new Map<string, TestUser>();
		const result = await importUsers(
			[
				{
					passwordHash: await hashPassword('s3cret1'),
					user: { email: 'alice@example.com', sub: 'u1' }
				},
				{
					passwordHash: await hashPassword('s3cret2'),
					user: { email: 'bob@example.com', sub: 'u2' }
				},
				{
					// no passwordHash → OAuth-only user, no credential write
					user: { email: 'carol@example.com', sub: 'u3' }
				}
			],
			{
				credentialStore,
				onCreateUser: async ({ user }) => {
					users.set(user.email, user);

					return {
						email: user.email,
						emailVerified: true,
						userId: user.sub
					};
				}
			}
		);

		expect(result.succeeded).toBe(3);
		expect(result.failed).toBe(0);
		expect(users.size).toBe(3);
		const alice =
			await credentialStore.getCredentialByEmail('alice@example.com');
		expect(alice?.passwordHash.startsWith('$argon2id$')).toBe(true);
		const carol =
			await credentialStore.getCredentialByEmail('carol@example.com');
		// OAuth-only: no credential row written.
		expect(carol).toBeUndefined();
	});

	test('reports failures without aborting the batch', async () => {
		const credentialStore = createInMemoryCredentialStore();
		const result = await importUsers(
			[
				{
					passwordHash: await hashPassword('ok'),
					user: { email: 'good@example.com', sub: 'u1' }
				},
				{
					passwordHash: await hashPassword('blocked'),
					user: { email: 'blocked@example.com', sub: 'u2' }
				}
			],
			{
				credentialStore,
				onCreateUser: async ({ user }) => {
					if (user.email === 'blocked@example.com') {
						throw new Error('blocked by policy');
					}

					return { email: user.email, userId: user.sub };
				}
			}
		);

		expect(result.succeeded).toBe(1);
		expect(result.failed).toBe(1);
		const blockedResult = result.results.find(
			(r) => r.user.email === 'blocked@example.com'
		);
		expect(blockedResult?.ok).toBe(false);
		if (blockedResult?.ok === false) {
			expect(blockedResult.error).toContain('blocked by policy');
		}
	});

	test('importUser exposes a single-record entry point for streaming imports', async () => {
		const credentialStore = createInMemoryCredentialStore();
		const result = await importUser(
			{
				passwordHash: await hashPassword('streamy'),
				user: { email: 'stream@example.com', sub: 's1' }
			},
			{
				credentialStore,
				onCreateUser: async ({ user }) => ({
					email: user.email,
					userId: user.sub
				})
			}
		);
		expect(result.ok).toBe(true);
	});
});

describe('passwordVerifier override + rehashOnLogin (end-to-end)', () => {
	const buildApp = async ({
		passwordHash,
		rehashOnLogin = false
	}: {
		passwordHash: string;
		rehashOnLogin?: boolean;
	}) => {
		const credentialStore = createInMemoryCredentialStore();
		const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
		const users = new Map<string, TestUser>();
		users.set('imported@example.com', {
			email: 'imported@example.com',
			sub: 'imported-1'
		});
		await importUser(
			{
				passwordHash,
				user: { email: 'imported@example.com', sub: 'imported-1' }
			},
			{
				credentialStore,
				onCreateUser: async ({ user }) => ({
					email: user.email,
					userId: user.sub
				})
			}
		);
		const authInstance = await auth<TestUser>({
			authSessionStore,
			credentials: {
				credentialStore,
				getUserByEmail: (email) => users.get(email) ?? null,
				onCreateCredentialUser: ({ email }) => {
					const user = { email, sub: `u:${email}` };
					users.set(email, user);

					return user;
				},
				onSendEmail: () => undefined,
				passwordPolicy: { minLength: 4 },
				passwordVerifier: async (password, storedHash) => {
					if (storedHash.startsWith('auth0_pbkdf2:')) {
						return verifyAuth0Pbkdf2(password, storedHash);
					}
					if (storedHash.startsWith('cognito_sha256:')) {
						return verifyCognitoSha256(password, storedHash);
					}
					// argon2id + bcrypt — fall through to Bun's native verify.
					return Bun.password.verify(password, storedHash);
				},
				rehashOnLogin
			},
			providersConfiguration: {}
		});

		return { app: new Elysia().use(authInstance), credentialStore };
	};

	test('Auth0 PBKDF2 imported user can log in via the override', async () => {
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const wrapped = await buildAuth0Pbkdf2Hash('myAuth0Pwd', salt);
		const { app } = await buildApp({ passwordHash: wrapped });

		const response = await app.handle(
			new Request('http://localhost/auth/login', {
				body: JSON.stringify({
					email: 'imported@example.com',
					password: 'myAuth0Pwd'
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_OK);
	});

	test('Cognito SHA-256 imported user can log in via the override', async () => {
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const wrapped = await buildCognitoSha256Hash('myCognitoPwd', salt);
		const { app } = await buildApp({ passwordHash: wrapped });

		const response = await app.handle(
			new Request('http://localhost/auth/login', {
				body: JSON.stringify({
					email: 'imported@example.com',
					password: 'myCognitoPwd'
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_OK);
	});

	test('rehashOnLogin upgrades a legacy hash to Argon2id after a successful login', async () => {
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const wrapped = await buildAuth0Pbkdf2Hash('upgradePwd', salt);
		const { app, credentialStore } = await buildApp({
			passwordHash: wrapped,
			rehashOnLogin: true
		});

		await app.handle(
			new Request('http://localhost/auth/login', {
				body: JSON.stringify({
					email: 'imported@example.com',
					password: 'upgradePwd'
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);

		const stored = await credentialStore.getCredentialByEmail(
			'imported@example.com'
		);
		expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);
	});

	test('wrong password still fails through the override', async () => {
		const salt = crypto.getRandomValues(new Uint8Array(16));
		const wrapped = await buildAuth0Pbkdf2Hash('correctPwd', salt);
		const { app } = await buildApp({ passwordHash: wrapped });

		const response = await app.handle(
			new Request('http://localhost/auth/login', {
				body: JSON.stringify({
					email: 'imported@example.com',
					password: 'wrongPwd'
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(response.status).toBe(HTTP_UNAUTHORIZED);
	});
});

describe('rehashCredentialPassword direct call', () => {
	test('updates a record in-place with a fresh Argon2id hash', async () => {
		const credentialStore = createInMemoryCredentialStore();
		await credentialStore.saveCredential({
			createdAt: Date.now(),
			email: 'rehash@example.com',
			emailVerified: true,
			passwordHash: 'auth0_pbkdf2:abc:def:1',
			status: 'active',
			updatedAt: Date.now()
		});
		const before =
			await credentialStore.getCredentialByEmail('rehash@example.com');
		expect(before?.passwordHash.startsWith('auth0_pbkdf2:')).toBe(true);

		await rehashCredentialPassword({
			credentialStore,
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- just saved above
			current: before!,
			plainPassword: 'newPlainText'
		});

		const after =
			await credentialStore.getCredentialByEmail('rehash@example.com');
		expect(after?.passwordHash.startsWith('$argon2id$')).toBe(true);
		expect(after?.email).toBe('rehash@example.com');
	});
});
