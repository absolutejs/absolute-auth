import { SQL } from 'bun';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sql';
import { runMigrations, type MigrationClient } from '../src/migrations/runner';
import { createPostgresOidcRefreshTokenStore } from '../src/oidc/postgresStores';

const databaseUrl = process.env['MIGRATION_TEST_DATABASE_URL'];
const MINUTE_MS = 60_000;

describe.skipIf(databaseUrl === undefined)(
	'Postgres refresh-token families',
	() => {
		test('lists, finds, rotates and revokes one family at a time', async () => {
			if (databaseUrl === undefined)
				throw new Error('MIGRATION_TEST_DATABASE_URL is required');
			// Own database: the migration integration test expects a fresh journal.
			const admin = new SQL({ max: 1, prepare: false, url: databaseUrl });
			const database = `auth_families_${crypto.randomUUID().replaceAll('-', '')}`;
			await admin`CREATE DATABASE ${admin(database)}`;
			const url = new URL(databaseUrl);
			url.pathname = `/${database}`;
			const sql = new SQL({
				max: 1,
				prepare: false,
				url: url.toString()
			});
			const userId = `family-user-${crypto.randomUUID()}`;
			try {
				const client: MigrationClient = {
					query: async (text, values = []) => ({
						rows: Array.from(await sql.unsafe(text, [...values]))
					})
				};
				await runMigrations({
					blocks: ['oidc'],
					client,
					log: () => undefined
				});
				const [index] = await sql<Array<{ count: number }>>`
					SELECT count(*)::int AS count FROM pg_indexes
					WHERE tablename = 'auth_oauth_refresh_tokens'
						AND indexname = 'auth_oauth_refresh_tokens_family_id_idx'`;
				expect(index?.count).toBe(1);
				const store = createPostgresOidcRefreshTokenStore(
					drizzle({ client: sql })
				);
				const now = Date.now();
				const base = {
					clientId: 'terminal',
					expiresAt: now + MINUTE_MS,
					scopes: ['codes'],
					userId
				};
				const laptop = `${userId}-laptop`;
				const desktop = `${userId}-desktop`;
				await store.saveToken({
					...base,
					createdAt: now - 2,
					familyId: laptop,
					tokenHash: `${laptop}-1`
				});
				await store.saveToken({
					...base,
					createdAt: now - 1,
					familyId: desktop,
					tokenHash: `${desktop}-1`
				});
				await store.saveToken({
					...base,
					createdAt: now,
					expiresAt: now - 1,
					familyId: `${userId}-expired`,
					tokenHash: `${userId}-expired-1`
				});

				expect(
					(await store.listFamilies?.(userId, 'terminal'))?.map(
						(family) => family.familyId
					)
				).toEqual([desktop, laptop]);

				const rotatedAt = now + 5;
				expect(
					await store.rotateToken(`${laptop}-1`, {
						...base,
						createdAt: rotatedAt,
						familyId: laptop,
						tokenHash: `${laptop}-2`
					})
				).toBe(true);
				const found = await store.getFamily?.(laptop);
				expect(found?.issuedAt).toBe(rotatedAt);
				expect(found).not.toHaveProperty('tokenHash');

				expect(await store.revokeFamily?.('someone-else', laptop)).toBe(
					false
				);
				expect(await store.revokeFamily?.(userId, laptop)).toBe(true);
				expect(await store.getFamily?.(laptop)).toBeUndefined();
				expect(await store.getToken(`${laptop}-2`)).toBeUndefined();
				expect(await store.getFamily?.(desktop)).toBeDefined();
			} finally {
				await sql.close();
				await admin`DROP DATABASE IF EXISTS ${admin(database)}`;
				await admin.close();
			}
		});
	}
);
