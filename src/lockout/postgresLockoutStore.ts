import { eq } from 'drizzle-orm';
import { bigint, integer, pgTable, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { LockoutRecord, LockoutStore } from './types';

const KEY_LENGTH = 320;

export const lockoutsTable = pgTable('auth_lockouts', {
	failed_attempts: integer('failed_attempts').notNull().default(0),
	key: varchar('key', { length: KEY_LENGTH }).primaryKey(),
	locked_until_ms: bigint('locked_until_ms', { mode: 'number' }),
	window_started_at_ms: bigint('window_started_at_ms', {
		mode: 'number'
	}).notNull()
});

type LockoutRow = typeof lockoutsTable.$inferSelect;
type LockoutInsert = typeof lockoutsTable.$inferInsert;

const toRecord = (row: LockoutRow): LockoutRecord => ({
	failedAttempts: row.failed_attempts,
	key: row.key,
	lockedUntil: row.locked_until_ms ?? undefined,
	windowStartedAt: row.window_started_at_ms
});

export const createNeonLockoutStore = (databaseUrl: string) =>
	createPostgresLockoutStore(createNeonDatabase(databaseUrl));
export const createPostgresLockoutStore = <DB extends AnyPgDatabase>(
	db: DB
): LockoutStore => {
	const get = async (key: string) => {
		const [row] = await db
			.select()
			.from(lockoutsTable)
			.where(eq(lockoutsTable.key, key))
			.limit(1);

		return row ? toRecord(row) : undefined;
	};
	const save = async (record: LockoutRecord) => {
		const values: LockoutInsert = {
			failed_attempts: record.failedAttempts,
			key: record.key,
			locked_until_ms: record.lockedUntil ?? null,
			window_started_at_ms: record.windowStartedAt
		};
		await db
			.insert(lockoutsTable)
			.values(values)
			.onConflictDoUpdate({ set: values, target: lockoutsTable.key });
	};

	return {
		get,
		increment: async (key, windowMs) => {
			const now = Date.now();
			const existing = await get(key);
			const next: LockoutRecord =
				existing !== undefined &&
				now - existing.windowStartedAt <= windowMs
					? {
							...existing,
							failedAttempts: existing.failedAttempts + 1
						}
					: { failedAttempts: 1, key, windowStartedAt: now };
			await save(next);

			return next;
		},
		lock: async (key, lockedUntil) => {
			const existing = (await get(key)) ?? {
				failedAttempts: 0,
				key,
				windowStartedAt: Date.now()
			};
			await save({ ...existing, lockedUntil });
		},
		reset: async (key) => {
			await db.delete(lockoutsTable).where(eq(lockoutsTable.key, key));
		}
	};
};
