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
	/** Existing SQL client. When provided, the runner does not create or close a pool. */
	client?: MigrationClient;
	/** Postgres connection string used by the default Neon-compatible pool. */
	databaseUrl?: string;
	/** Subset of blocks to apply. Omit to apply every block the package ships. */
	blocks?: BlockName[];
	/** Optional logger; defaults to console.log. Pass `() => undefined` for silent mode. */
	log?: (message: string) => void;
};

export type MigrationRunResult = {
	applied: string[];
	skipped: string[];
};

export type MigrationQueryResult = {
	rows: unknown[];
};

export type MigrationClient = {
	query: (
		text: string,
		values?: readonly unknown[]
	) => Promise<MigrationQueryResult>;
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

const isBlockName = (value: string): value is BlockName =>
	Object.hasOwn(blockMigrations, value);

const allBlockNames = () => Object.keys(blockMigrations).filter(isBlockName);

const applyOne = async (
	client: MigrationClient,
	id: string,
	sql: string,
	log: (message: string) => void
) => {
	await client.query(sql);
	await client.query(
		`INSERT INTO "auth_migrations" ("id", "applied_at_ms") VALUES ($1, $2)`,
		[id, Date.now()]
	);
	log(`apply  ${id}`);
};

const runOne = async (
	client: MigrationClient,
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
	await applyOne(client, id, sql, log);
	result.applied.push(id);
};

export const runMigrations = async ({
	blocks,
	client,
	databaseUrl,
	log = console.log
}: RunMigrationsOptions) => {
	let ownedPool: Pool | undefined;
	let migrationClient: MigrationClient;
	if (client !== undefined) {
		migrationClient = client;
	} else {
		if (databaseUrl === undefined)
			throw new Error('runMigrations requires databaseUrl or client');
		ownedPool = new Pool({ connectionString: databaseUrl });
		migrationClient = ownedPool;
	}
	const result: MigrationRunResult = { applied: [], skipped: [] };

	try {
		await migrationClient.query(JOURNAL_DDL);
		const journal = await migrationClient.query(
			`SELECT "id" FROM "auth_migrations"`
		);
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

			return runOne(
				migrationClient,
				item.id,
				item.sql,
				applied,
				result,
				log
			);
		}, Promise.resolve());
	} finally {
		await ownedPool?.end();
	}

	return result;
};
