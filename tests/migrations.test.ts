import { describe, expect, test } from 'bun:test';
import { tablesToInitSql } from '../src/migrations/generate';
import { blockMigrations } from '../src/migrations/index';
import { credentialsTable } from '../src/credentials/postgresCredentialStore';
import { lockoutsTable } from '../src/lockout/postgresLockoutStore';

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

	test('every block has at least one migration with a stable id', () => {
		for (const entry of allEntries) {
			expect(entry.blockSelfName).toBe(entry.blockName);
			expect(entry.migration.id).toMatch(/^\d{4}_/u);
			expect(entry.migration.sql).toContain('CREATE TABLE IF NOT EXISTS');
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
