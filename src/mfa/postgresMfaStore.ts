import { eq } from 'drizzle-orm';
import { bigint, boolean, jsonb, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { MfaEnrollment, MFAStore } from './types';

const ID_LENGTH = 255;

export const mfaEnrollmentsTable = pgTable('auth_mfa_enrollments', {
	backup_code_hashes: jsonb('backup_code_hashes')
		.$type<string[]>()
		.notNull()
		.default([]),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	last_used_at_ms: bigint('last_used_at_ms', { mode: 'number' }),
	totp_secret_ciphertext: text('totp_secret_ciphertext'),
	totp_verified: boolean('totp_verified').notNull().default(false),
	updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull(),
	user_id: varchar('user_id', { length: ID_LENGTH }).primaryKey()
});

type MfaRow = typeof mfaEnrollmentsTable.$inferSelect;
type MfaInsert = typeof mfaEnrollmentsTable.$inferInsert;

const toEnrollment = (row: MfaRow): MfaEnrollment => ({
	backupCodeHashes: row.backup_code_hashes,
	createdAt: row.created_at_ms,
	lastUsedAt: row.last_used_at_ms ?? undefined,
	totpSecretCiphertext: row.totp_secret_ciphertext ?? undefined,
	totpVerified: row.totp_verified,
	updatedAt: row.updated_at_ms,
	userId: row.user_id
});

export const createNeonMfaStore = (databaseUrl: string) =>
	createPostgresMfaStore(createNeonDatabase(databaseUrl));
export const createPostgresMfaStore = (db: AnyPgDatabase): MFAStore => ({
	getEnrollment: async (userId) => {
		const [row] = await db
			.select()
			.from(mfaEnrollmentsTable)
			.where(eq(mfaEnrollmentsTable.user_id, userId))
			.limit(1);

		return row ? toEnrollment(row) : undefined;
	},
	removeEnrollment: async (userId) => {
		await db
			.delete(mfaEnrollmentsTable)
			.where(eq(mfaEnrollmentsTable.user_id, userId));
	},
	saveEnrollment: async (enrollment) => {
		const values: MfaInsert = {
			backup_code_hashes: enrollment.backupCodeHashes,
			created_at_ms: enrollment.createdAt,
			last_used_at_ms: enrollment.lastUsedAt ?? null,
			totp_secret_ciphertext: enrollment.totpSecretCiphertext ?? null,
			totp_verified: enrollment.totpVerified,
			updated_at_ms: enrollment.updatedAt,
			user_id: enrollment.userId
		};
		await db
			.insert(mfaEnrollmentsTable)
			.values(values)
			.onConflictDoUpdate({
				set: values,
				target: mfaEnrollmentsTable.user_id
			});
	}
});
