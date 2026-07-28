import { SQL } from 'bun';
import { describe, expect, test } from 'bun:test';
import { tablesToInitSql } from '../src/migrations/generate';
import { blockMigrations } from '../src/migrations/index';
import { runMigrations, type MigrationClient } from '../src/migrations/runner';
import { credentialsTable } from '../src/credentials/postgresCredentialStore';
import { lockoutsTable } from '../src/lockout/postgresLockoutStore';

const LAST_QUERY_OFFSET = -1;

// The runner test uses the actual `runMigrations` against a real Postgres only in CI when
// `MIGRATION_TEST_DATABASE_URL` is set. The unit tests below cover the SQL generation
// path + the block manifest shape — the runner itself is a thin shell over
// `pool.query()` that we don't try to mock end-to-end (the value is in the SQL it emits).

describe('tablesToInitSql', () => {
	test('emits CREATE TABLE IF NOT EXISTS with the correct table name + columns', () => {
		const sql = tablesToInitSql([lockoutsTable]);
		expect(sql).toContain('CREATE TABLE IF NOT EXISTS "auth_lockouts"');
		expect(sql).toContain('"key"');
		expect(sql).toContain('PRIMARY KEY');
		expect(sql).toContain('"failed_attempts"');
		expect(sql).toContain('"window_started_at_ms"');
		expect(sql).toContain('NOT NULL');
	});

	test('joins multiple tables with blank lines between statements', () => {
		const sql = tablesToInitSql([lockoutsTable, credentialsTable]);
		expect(
			sql.match(/CREATE TABLE IF NOT EXISTS/gu)?.length ?? 0
		).toBeGreaterThanOrEqual(2);
		expect(sql).toContain('"auth_lockouts"');
		expect(sql).toContain('"auth_credentials"');
	});

	test('emits a default value when the column has one', () => {
		const sql = tablesToInitSql([credentialsTable]);
		// `status` column defaults to 'active'.
		expect(sql).toContain("DEFAULT 'active'");
		// `email_verified` column defaults to false.
		expect(sql).toContain('DEFAULT false');
	});
});

describe('blockMigrations manifest', () => {
	const allEntries = Object.entries(blockMigrations).flatMap(
		([name, block]) =>
			block.migrations.map((migration) => ({
				blockName: name,
				blockSelfName: block.block,
				migration
			}))
	);

	test('every migration has a stable, ordered id and a self-consistent block name', () => {
		for (const entry of allEntries) {
			expect(entry.blockSelfName).toBe(entry.blockName);
			expect(entry.migration.id).toMatch(/^\d{4}_/u);
		}
	});

	test('every block creates its tables in a base migration', () => {
		// The init migration (`0001_*`) creates tables; later additive migrations
		// (`ALTER TABLE ... ADD COLUMN`) legitimately do not.
		for (const block of Object.values(blockMigrations)) {
			const createsTables = block.migrations.some((migration) =>
				migration.sql.includes('CREATE TABLE IF NOT EXISTS')
			);
			expect(createsTables).toBe(true);
		}
	});

	test('every block names tables prefixed with auth_ or a known package prefix', () => {
		// Catches accidental cross-package collision; intent + similar consumers will own
		// any non-`auth_` namespace and we shouldn't ship migrations that touch theirs.
		const PACKAGE_PREFIXES = ['auth_', 'linked_provider_'];
		const allTableNames = allEntries.flatMap((entry) =>
			Array.from(
				entry.migration.sql.matchAll(
					/CREATE TABLE IF NOT EXISTS "([^"]+)"/gu
				)
			).map((match) => match[1] ?? '')
		);
		for (const tableName of allTableNames) {
			expect(
				PACKAGE_PREFIXES.some((prefix) => tableName.startsWith(prefix))
			).toBe(true);
		}
	});
});

describe('runMigrations', () => {
	test('uses an injected standard Postgres client without owning its lifecycle', async () => {
		const queries: Array<{
			text: string;
			values: readonly unknown[] | undefined;
		}> = [];
		const client: MigrationClient = {
			query: async (text, values) => {
				queries.push({ text, values });

				return {
					rows: text.startsWith('SELECT')
						? [{ id: 'vault/already-applied' }]
						: []
				};
			}
		};

		const result = await runMigrations({
			blocks: ['vault'],
			client,
			log: () => undefined
		});

		expect(result).toEqual({
			applied: ['vault/0001_init'],
			skipped: []
		});
		expect(queries[0]?.text).toContain(
			'CREATE TABLE IF NOT EXISTS "auth_migrations"'
		);
		expect(
			queries.some(({ text }) => text.includes('"auth_vault_entries"'))
		).toBe(true);
		expect(queries.at(LAST_QUERY_OFFSET)?.values?.[0]).toBe(
			'vault/0001_init'
		);
	});

	test('requires either a database URL or an injected client', async () => {
		await expect(
			runMigrations({ blocks: ['vault'], log: () => undefined })
		).rejects.toThrow('requires databaseUrl or client');
	});
});

const migrationDatabaseUrl = process.env['MIGRATION_TEST_DATABASE_URL'];

describe.skipIf(migrationDatabaseUrl === undefined)(
	'runMigrations Postgres integration',
	() => {
		test('applies and journals migrations through an injected Bun SQL client', async () => {
			if (migrationDatabaseUrl === undefined)
				throw new Error('MIGRATION_TEST_DATABASE_URL is required');
			const sql = new SQL({
				max: 1,
				prepare: false,
				url: migrationDatabaseUrl
			});
			const client: MigrationClient = {
				query: async (text, values = []) => ({
					rows: Array.from(await sql.unsafe(text, [...values]))
				})
			};

			try {
				const first = await runMigrations({
					blocks: ['vault'],
					client,
					log: () => undefined
				});
				const second = await runMigrations({
					blocks: ['vault'],
					client,
					log: () => undefined
				});
				const [table] = await sql<
					Array<{ table_name: string | null }>
				>`SELECT to_regclass('public.auth_vault_entries')::text AS table_name`;

				expect(first.applied).toEqual(['vault/0001_init']);
				expect(second.skipped).toContain('vault/0001_init');
				expect(table?.table_name).toBe('auth_vault_entries');
			} finally {
				await sql.close();
			}
		});
	}
);
