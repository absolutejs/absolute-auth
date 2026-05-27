// Migration runner. Uses `@neondatabase/serverless`'s Pool (already a package dep) so
// consumers don't need to install drizzle-kit or a separate migrator. The Pool client
// supports multi-statement queries (a block's init migration emits one CREATE TABLE per
// table joined by `;`), which the HTTP `neon()` function does not.
//
// Tracks applied migrations in an `auth_migrations` table keyed by `${block}/${id}`.
// Idempotent — re-running is a no-op when everything's been applied.
//
// Consumers can invoke programmatically (`await runMigrations({ databaseUrl })`) at boot
// or via the bundled CLI (`bunx absolute-auth migrate --db $DATABASE_URL`).

import { Pool } from '@neondatabase/serverless';
import { blockMigrations, type BlockName } from './index';

export type RunMigrationsOptions = {
	databaseUrl: string;
	/** Subset of blocks to apply. Omit to apply every block the package ships. */
	blocks?: BlockName[];
	/** Optional logger; defaults to console.log. Pass `() => undefined` for silent mode. */
	log?: (message: string) => void;
};

export type MigrationRunResult = {
	applied: string[];
	skipped: string[];
};

const JOURNAL_DDL = `CREATE TABLE IF NOT EXISTS "auth_migrations" (
	"id" text PRIMARY KEY,
	"applied_at_ms" bigint NOT NULL
);`;

type JournalRow = { id: string };

const isJournalRow = (value: unknown): value is JournalRow =>
	typeof value === 'object' &&
	value !== null &&
	typeof Reflect.get(value, 'id') === 'string';

const allBlockNames = () =>
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Object.keys widens to string[]; the values are typed BlockName by construction of the manifest
	Object.keys(blockMigrations) as BlockName[];

const applyOne = async (
	pool: Pool,
	id: string,
	sql: string,
	log: (message: string) => void
) => {
	await pool.query(sql);
	await pool.query(
		`INSERT INTO "auth_migrations" ("id", "applied_at_ms") VALUES ($1, $2)`,
		[id, Date.now()]
	);
	log(`apply  ${id}`);
};

const runOne = async (
	pool: Pool,
	id: string,
	sql: string,
	applied: Set<string>,
	result: MigrationRunResult,
	log: (message: string) => void
) => {
	if (applied.has(id)) {
		result.skipped.push(id);
		log(`skip   ${id}`);

		return;
	}
	await applyOne(pool, id, sql, log);
	result.applied.push(id);
};

export const runMigrations = async ({
	blocks,
	databaseUrl,
	log = console.log
}: RunMigrationsOptions) => {
	const pool = new Pool({ connectionString: databaseUrl });
	const result: MigrationRunResult = { applied: [], skipped: [] };

	try {
		await pool.query(JOURNAL_DDL);
		const journal = await pool.query(`SELECT "id" FROM "auth_migrations"`);
		const applied = new Set(
			journal.rows.filter(isJournalRow).map((row) => row.id)
		);

		const selected = blocks ?? allBlockNames();
		const flat = selected.flatMap((block) =>
			blockMigrations[block].migrations.map((migration) => ({
				id: `${block}/${migration.id}`,
				sql: migration.sql
			}))
		);

		await flat.reduce(async (prior, item) => {
			await prior;

			return runOne(pool, item.id, item.sql, applied, result, log);
		}, Promise.resolve());
	} finally {
		await pool.end();
	}

	return result;
};
