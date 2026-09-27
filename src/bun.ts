/** Bun-only PostgreSQL migrations. Keep this entry separate from browser imports. */
import { SQL } from 'bun';
import { runMigrations, type RunMigrationsOptions } from './migrations/runner';

export type BunMigrationsOptions = Pick<
	RunMigrationsOptions,
	'blocks' | 'log'
> & {
	databaseUrl: string;
};

/** Owns its connection; serializes and atomically journals package-owned DDL. */
export const runBunMigrations = async ({
	databaseUrl,
	blocks,
	log
}: BunMigrationsOptions) => {
	if (!/^postgres(?:ql)?:\/\//u.test(databaseUrl))
		throw new Error('runBunMigrations requires a PostgreSQL database URL');
	const client = new SQL({ max: 1, prepare: false, url: databaseUrl });
	try {
		return await client.begin(async (transaction) => {
			await transaction`SELECT pg_advisory_xact_lock(hashtext('absolutejs:auth:migrations'))`;

			return runMigrations({
				blocks,
				client: {
					query: async (text, values = []) => ({
						rows: Array.from(
							await transaction.unsafe(text, [...values])
						)
					})
				},
				log
			});
		});
	} finally {
		await client.close();
	}
};
