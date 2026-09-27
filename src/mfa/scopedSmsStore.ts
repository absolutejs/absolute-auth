import { and, eq, lte, sql } from 'drizzle-orm';
import { pgTable, text, bigint, jsonb, index } from 'drizzle-orm/pg-core';
import { hashToken } from '../crypto';
import type { AnyPgDatabase } from '../stores/postgres';
import { createInMemoryMfaStore } from './inMemoryMfaStore';
import type {
	MFAStore,
	MfaEnrollment,
	SmsChallengeScope,
	SmsChallengeStore
} from './types';

export const mfaSmsChallengesTable = pgTable(
	'auth_mfa_sms_challenges',
	{
		expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
		scope_key: text('scope_key').primaryKey(),
		state: jsonb('state').$type<MfaEnrollment>().notNull(),
		user_id: text('user_id').notNull()
	},
	(table) => [
		index('auth_mfa_sms_challenges_expiry_idx').on(table.expires_at_ms),
		index('auth_mfa_sms_challenges_user_idx').on(table.user_id)
	]
);
const MAX_CAS_RETRIES = 16;

// Reuse the in-memory SMS transition rules, committing each transition with a
// JSON compare-and-swap. No SMS delivery or provider call occurs inside retries.
export const createPostgresSmsChallengeStore = async <DB extends AnyPgDatabase>(
	db: DB,
	scope: SmsChallengeScope
): Promise<SmsChallengeStore> => {
	const table = mfaSmsChallengesTable;
	const key = await hashToken(
		JSON.stringify([scope.userId, scope.sessionId, scope.factorId])
	);
	await db.delete(table).where(lte(table.expires_at_ms, Date.now()));
	const read = async () =>
		(
			await db
				.select({ state: table.state })
				.from(table)
				.where(eq(table.scope_key, key))
				.limit(1)
		)[0]?.state;
	const transition = async <T>(
		apply: (store: MFAStore) => Promise<T>,
		retries = MAX_CAS_RETRIES
	): Promise<T> => {
		if (retries === 0)
			throw new Error('SMS challenge contention; retry request');
		const expected = await read();
		const memory = createInMemoryMfaStore();
		if (expected) await memory.saveEnrollment(expected);
		const result = await apply(memory);
		const next = await memory.getEnrollment(scope.userId);
		if (JSON.stringify(expected) === JSON.stringify(next)) return result;
		const match = and(
			eq(table.scope_key, key),
			sql`${table.state} = ${JSON.stringify(expected)}::jsonb`
		);
		let rows: Array<{ key: string }>;
		if (next === undefined)
			rows = await db
				.delete(table)
				.where(match)
				.returning({ key: table.scope_key });
		else if (expected === undefined)
			rows = await db
				.insert(table)
				.values({
					expires_at_ms: scope.expiresAt,
					scope_key: key,
					state: next,
					user_id: scope.userId
				})
				.onConflictDoNothing()
				.returning({ key: table.scope_key });
		else
			rows = await db
				.update(table)
				.set({ state: next })
				.where(match)
				.returning({ key: table.scope_key });

		return rows.length === 1 ? result : transition(apply, retries - 1);
	};

	return {
		claimSmsChallenge: (input) =>
			transition((store) => store.claimSmsChallenge(input)),
		completeSmsChallenge: (input) =>
			transition((store) => store.completeSmsChallenge(input)),
		finalizeSmsChallenge: (input) =>
			transition((store) => store.finalizeSmsChallenge(input)),
		getEnrollment: async () => read(),
		recordSmsFailure: (input) =>
			transition((store) => store.recordSmsFailure(input)),
		rollbackSmsChallenge: (input) =>
			transition((store) => store.rollbackSmsChallenge(input))
	};
};
