import { SQL } from 'bun';
import { expect, test } from 'bun:test';
import { runBunMigrations } from '../src/bun';
import { blockMigrations } from '../src/migrations';

test('Bun migrations reject non-PostgreSQL URLs without echoing credentials', async () => {
	await expect(
		runBunMigrations({
			databaseUrl: 'https://private:secret@example.invalid'
		})
	).rejects.toThrow('requires a PostgreSQL database URL');
});
const databaseUrl = process.env['BUN_MIGRATION_TEST_DATABASE_URL'];
(databaseUrl ? test : test.skip)(
	'Bun migration rollback, concurrent startup and idempotent restart on real Postgres',
	async () => {
		if (!databaseUrl)
			throw new Error('Dedicated disposable database required');
		const client = new SQL({ max: 1, prepare: false, url: databaseUrl });
		try {
			await client`CREATE TABLE auth_migrations (id text PRIMARY KEY, applied_at_ms bigint NOT NULL)`;
			await client`CREATE FUNCTION reject_test_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id LIKE 'credentials/%' THEN RAISE EXCEPTION 'synthetic journal failure'; END IF; RETURN NEW; END $$`;
			await client`CREATE TRIGGER reject_test_journal BEFORE INSERT ON auth_migrations FOR EACH ROW EXECUTE FUNCTION reject_test_journal()`;
			await expect(
				runBunMigrations({
					blocks: ['sessions', 'credentials'],
					databaseUrl,
					log: () => undefined
				})
			).rejects.toThrow('synthetic journal failure');
			const [rollback] =
				await client`SELECT to_regclass('auth_sessions')::text AS sessions, (SELECT count(*)::integer FROM auth_migrations) AS journal`;
			expect(rollback).toMatchObject({ journal: 0, sessions: null });
			await client`DROP TRIGGER reject_test_journal ON auth_migrations`;
			await client`DROP FUNCTION reject_test_journal()`;
			const results = await Promise.all([
				runBunMigrations({ databaseUrl, log: () => undefined }),
				runBunMigrations({ databaseUrl, log: () => undefined })
			]);
			const ids = Object.entries(blockMigrations).flatMap(
				([block, definition]) =>
					definition.migrations.map(
						(migration) => `${block}/${migration.id}`
					)
			);
			expect(results.flatMap((result) => result.applied).sort()).toEqual(
				[...ids].sort()
			);
			expect(results.flatMap((result) => result.skipped).sort()).toEqual(
				[...ids].sort()
			);
			expect(
				(await runBunMigrations({ databaseUrl, log: () => undefined }))
					.skipped
			).toHaveLength(ids.length);
		} finally {
			await client.close();
		}
	},
	30000
);
