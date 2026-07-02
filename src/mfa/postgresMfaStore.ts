import { eq } from 'drizzle-orm';
import {
	bigint,
	boolean,
	jsonb,
	pgTable,
	smallint,
	text,
	varchar
} from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { MfaEnrollment, MFAStore } from './types';

const ID_LENGTH = 255;
const PHONE_LENGTH = 20;

export const mfaEnrollmentsTable = pgTable('auth_mfa_enrollments', {
	backup_code_hashes: jsonb('backup_code_hashes')
		.$type<string[]>()
		.notNull()
		.default([]),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	last_used_at_ms: bigint('last_used_at_ms', { mode: 'number' }),
	sms_failed_attempts: smallint('sms_failed_attempts').notNull().default(0),
	sms_pending_code_expires_at_ms: bigint('sms_pending_code_expires_at_ms', {
		mode: 'number'
	}),
	sms_pending_code_hash: text('sms_pending_code_hash'),
	sms_phone: varchar('sms_phone', { length: PHONE_LENGTH }),
	sms_verified: boolean('sms_verified').notNull().default(false),
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
	smsFailedAttempts: row.sms_failed_attempts,
	smsPendingCodeExpiresAt: row.sms_pending_code_expires_at_ms ?? undefined,
	smsPendingCodeHash: row.sms_pending_code_hash ?? undefined,
	smsPhone: row.sms_phone ?? undefined,
	smsVerified: row.sms_verified,
	totpSecretCiphertext: row.totp_secret_ciphertext ?? undefined,
	totpVerified: row.totp_verified,
	updatedAt: row.updated_at_ms,
	userId: row.user_id
});

export const createNeonMfaStore = (databaseUrl: string) =>
	createPostgresMfaStore(createNeonDatabase(databaseUrl));
export const createPostgresMfaStore = <DB extends AnyPgDatabase>(
	db: DB
): MFAStore => ({
	getEnrollment: async (userId) => {
		const [row] = await db
			.select()
			.from(mfaEnrollmentsTable)
			.where(eq(mfaEnrollmentsTable.user_id, userId))
			.limit(1);

		return row ? toEnrollment(row) : undefined;
	},
	listEnrollments: async () => {
		const rows = await db.select().from(mfaEnrollmentsTable);

		return rows.map(toEnrollment);
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
			sms_failed_attempts: enrollment.smsFailedAttempts ?? 0,
			sms_pending_code_expires_at_ms:
				enrollment.smsPendingCodeExpiresAt ?? null,
			sms_pending_code_hash: enrollment.smsPendingCodeHash ?? null,
			sms_phone: enrollment.smsPhone ?? null,
			sms_verified: enrollment.smsVerified,
			totp_secret_ciphertext: enrollment.totpSecretCiphertext ?? null,
			totp_verified: enrollment.totpVerified,
			updated_at_ms: enrollment.updatedAt,
			user_id: enrollment.userId
		};
		await db.insert(mfaEnrollmentsTable).values(values).onConflictDoUpdate({
			set: values,
			target: mfaEnrollmentsTable.user_id
		});
	}
});
