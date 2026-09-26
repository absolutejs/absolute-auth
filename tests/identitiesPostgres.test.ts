import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { AuthIdentityConflictError } from '../src/errors';
import { createPostgresIdentityStore } from '../src/identities/postgresIdentityStore';
import { blockMigrations } from '../src/migrations';
import { tablesToInitSql } from '../src/migrations/generate';
import {
	createPostgresWebAuthnCredentialStore,
	webauthnCredentialsTable
} from '../src/webauthn/postgresWebAuthnCredentialStore';

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL?.replace(
	'-pooler.',
	'.'
);
const postgresTest = databaseUrl ? test : test.skip;

postgresTest(
	'Postgres identities keep one provider account on one user; passkeys keep names',
	async () => {
		if (!databaseUrl) throw new Error('Test database required');
		const schema = `identity_test_${crypto.randomUUID().replaceAll('-', '')}`;
		const sql = new SQL(databaseUrl, { max: 1 });
		try {
			await sql.unsafe(`CREATE SCHEMA ${schema}`);
			await sql.unsafe(`SET search_path TO ${schema}`);
			const identitySql = blockMigrations.identities.migrations
				.map((migration) => migration.sql)
				.join('\n');
			await sql.unsafe(identitySql);
			// Re-running also upgrades a table created before this block existed.
			await sql.unsafe(identitySql);
			await sql.unsafe(
				[
					tablesToInitSql([webauthnCredentialsTable]),
					...blockMigrations.webauthn.migrations
						.slice(2)
						.map((migration) => migration.sql)
				].join('\n')
			);

			const db = drizzle({ client: sql });
			const identities = createPostgresIdentityStore(db);
			const linked = await identities.linkIdentity({
				metadata: { email: 'a@example.com' },
				provider: 'google',
				providerSubject: 'g1',
				userId: 'alice'
			});
			expect(linked.status).toBe('linked');
			expect(
				(
					await identities.linkIdentity({
						provider: 'google',
						providerSubject: 'g1',
						userId: 'alice'
					})
				).status
			).toBe('already_linked');
			expect(
				identities.linkIdentity({
					provider: 'google',
					providerSubject: 'g1',
					userId: 'bob'
				})
			).rejects.toBeInstanceOf(AuthIdentityConflictError);
			// A row written by older app code with a different id still blocks a second user.
			await sql.unsafe(
				`INSERT INTO auth_identities (id, auth_provider, provider_subject, user_sub) VALUES ('legacy-id', 'github', 'gh1', 'carol')`
			);
			expect(
				identities.linkIdentity({
					provider: 'github',
					providerSubject: 'gh1',
					userId: 'bob'
				})
			).rejects.toBeInstanceOf(AuthIdentityConflictError);
			expect(
				(await identities.findIdentity('github', 'gh1'))?.userId
			).toBe('carol');
			await identities.touchIdentity(
				linked.identity.id,
				1_700_000_000_000
			);
			const [listed] = await identities.listIdentitiesByUser('alice');
			expect(listed?.lastUsedAt).toBe(1_700_000_000_000);
			expect(listed?.metadata).toEqual({ email: 'a@example.com' });
			await identities.removeIdentity(linked.identity.id);
			expect(await identities.listIdentitiesByUser('alice')).toEqual([]);

			const passkeys = createPostgresWebAuthnCredentialStore(db);
			await passkeys.saveCredential({
				counter: 0,
				createdAt: 1,
				credentialId: 'c1',
				name: 'iCloud Keychain',
				publicKey: 'k',
				userId: 'alice'
			});
			await passkeys.renameCredential?.('c1', 'Phone');
			expect((await passkeys.getCredential('c1'))?.name).toBe('Phone');
		} finally {
			await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
			await sql.close();
		}
	}
);
