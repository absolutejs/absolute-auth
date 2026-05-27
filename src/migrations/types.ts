// Migration manifest. Each block under `src/<block>/` that ships a Postgres store also
// ships a `migrations.ts` exporting a `BlockMigrations` so consumers can opt into the
// SQL with `runMigrations({ databaseUrl, blocks: ['credentials', 'mfa'] })` instead of
// hand-writing CREATE TABLE statements.

export type Migration = {
	/** Stable identifier — stored in `auth_migrations` to track applied state. Must be
	 *  monotonically ordered within a block (e.g. `0001_init`, `0002_add_foo_column`). */
	id: string;
	/** Idempotent SQL. Use `CREATE TABLE IF NOT EXISTS` so re-running is a no-op even if
	 *  the consumer wired the tables by hand before adopting the migration runner. */
	sql: string;
};

export type BlockMigrations = {
	/** Block name as used in the CLI's `--blocks` flag and in `runMigrations({ blocks })`.
	 *  Convention: same string as the `src/<block>/` directory. */
	block: string;
	migrations: Migration[];
};
