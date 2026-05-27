// Per-importer parse-only tests. Verifies each source format maps to
// the neutral ImportResult shape correctly. No DB writes — that's
// covered by integration tests against the postgres-test container.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auth0Importer } from '../src/cli/import/auth0';
import { clerkImporter } from '../src/cli/import/clerk';
import { luciaImporter } from '../src/cli/import/lucia';
import { nextauthImporter } from '../src/cli/import/nextauth';
import { supabaseImporter } from '../src/cli/import/supabase';

let workdir: string;

beforeEach(() => {
	workdir = mkdtempSync(join(tmpdir(), 'abs-auth-import-'));
});

afterEach(() => {
	rmSync(workdir, { force: true, recursive: true });
});

const write = (filename: string, payload: unknown) => {
	const path = join(workdir, filename);
	writeFileSync(path, JSON.stringify(payload));

	return path;
};

describe('CLI import — Auth0', () => {
	test('parses a typical user export + filters self-identity', async () => {
		const path = write('users.json', [
			{
				created_at: '2024-03-12T10:00:00.000Z',
				email: 'alice@x.test',
				email_verified: true,
				family_name: 'Smith',
				given_name: 'Alice',
				identities: [
					{
						connection: 'Username-Password-Authentication',
						provider: 'auth0',
						user_id: '663cffff'
					},
					{ provider: 'google-oauth2', user_id: '118391000000' }
				],
				password_hash: '$2b$10$abc',
				user_id: 'auth0|663cffff'
			}
		]);

		const result = await auth0Importer.parse(path);
		expect(result.users.length).toBe(1);
		expect(result.users[0]?.email).toBe('alice@x.test');
		expect(result.users[0]?.passwordHashAlgo).toBe('bcrypt');
		expect(result.identities.length).toBe(1);
		expect(result.identities[0]?.authProvider).toBe('google');
		expect(result.identities[0]?.providerSubject).toBe('118391000000');
	});

	test('parses NDJSON (one user per line)', async () => {
		const path = join(workdir, 'users.ndjson');
		writeFileSync(
			path,
			[
				JSON.stringify({
					email: 'a@x',
					identities: [{ provider: 'auth0', user_id: 'a' }],
					user_id: 'auth0|a'
				}),
				JSON.stringify({
					email: 'b@x',
					identities: [{ provider: 'auth0', user_id: 'b' }],
					user_id: 'auth0|b'
				})
			].join('\n')
		);
		const result = await auth0Importer.parse(path);
		expect(result.users.length).toBe(2);
		expect(result.identities.length).toBe(0); // both filtered (auth0 self)
	});
});

describe('CLI import — Clerk', () => {
	test('parses external_accounts + argon2id digest', async () => {
		const path = write('users.json', [
			{
				created_at: 1709999999000,
				email_addresses: [
					{
						email_address: 'alice@x.test',
						verification: { status: 'verified' }
					}
				],
				external_accounts: [
					{ provider: 'oauth_google', provider_user_id: '118391' }
				],
				first_name: 'Alice',
				id: 'user_2N',
				last_name: 'Smith',
				password_digest: '$argon2id$v=19$m=65536$abc'
			}
		]);

		const result = await clerkImporter.parse(path);
		expect(result.users[0]?.email).toBe('alice@x.test');
		expect(result.users[0]?.emailVerified).toBe(true);
		expect(result.users[0]?.passwordHashAlgo).toBe('argon2id');
		expect(result.identities[0]?.authProvider).toBe('google');
		expect(result.identities[0]?.providerSubject).toBe('118391');
	});
});

describe('CLI import — Supabase', () => {
	test('parses users + identities + bcrypt encrypted_password', async () => {
		const path = write('export.json', {
			identities: [
				{
					created_at: '2024-01-01T00:00:00Z',
					provider: 'google',
					provider_id: '118391000',
					user_id: '11111111-1111-1111-1111-111111111111'
				}
			],
			users: [
				{
					created_at: '2024-01-01T00:00:00Z',
					email: 'alice@x.test',
					email_confirmed_at: '2024-01-02T00:00:00Z',
					encrypted_password: '$2a$10$abc',
					id: '11111111-1111-1111-1111-111111111111',
					raw_user_meta_data: { full_name: 'Alice Smith' }
				}
			]
		});
		const result = await supabaseImporter.parse(path);
		expect(result.users[0]?.email).toBe('alice@x.test');
		expect(result.users[0]?.emailVerified).toBe(true);
		expect(result.users[0]?.givenName).toBe('Alice');
		expect(result.users[0]?.familyName).toBe('Smith');
		expect(result.users[0]?.passwordHashAlgo).toBe('bcrypt');
		expect(result.identities[0]?.authProvider).toBe('google');
	});
});

describe('CLI import — Lucia', () => {
	test('splits keys into password hash + identity rows by provider', async () => {
		const path = write('export.json', {
			keys: [
				{
					hashed_password: '$argon2id$v=19$m=65536$abc',
					id: 'email:alice@x.test',
					user_id: 'u1'
				},
				{ id: 'google:118391', user_id: 'u1' },
				{ id: 'github:9999', user_id: 'u1' }
			],
			users: [
				{ created_at: 1700000000, email: 'alice@x.test', id: 'u1' }
			]
		});
		const result = await luciaImporter.parse(path);
		expect(result.users[0]?.email).toBe('alice@x.test');
		expect(result.users[0]?.passwordHash).toContain('$argon2id$');
		expect(result.identities.length).toBe(2);
		expect(
			result.identities.map((identity) => identity.authProvider).sort()
		).toEqual(['github', 'google']);
	});
});

describe('CLI import — NextAuth', () => {
	test('parses users + accounts (oauth only) + optional password hashes', async () => {
		const path = write('export.json', {
			accounts: [
				{
					provider: 'google',
					providerAccountId: '118391',
					type: 'oauth',
					userId: 'u1'
				},
				// non-oauth accounts (e.g. legacy email) should be dropped.
				{
					provider: 'email',
					providerAccountId: 'token',
					type: 'email',
					userId: 'u1'
				}
			],
			passwordsByUserId: { u1: '$argon2id$v=19$m=65536$xyz' },
			users: [
				{
					email: 'alice@x.test',
					emailVerified: '2024-01-01T00:00:00Z',
					id: 'u1',
					name: 'Alice Smith'
				}
			]
		});
		const result = await nextauthImporter.parse(path);
		expect(result.users[0]?.email).toBe('alice@x.test');
		expect(result.users[0]?.emailVerified).toBe(true);
		expect(result.users[0]?.givenName).toBe('Alice');
		expect(result.users[0]?.familyName).toBe('Smith');
		expect(result.users[0]?.passwordHashAlgo).toBe('argon2id');
		expect(result.identities.length).toBe(1);
		expect(result.identities[0]?.authProvider).toBe('google');
	});
});
