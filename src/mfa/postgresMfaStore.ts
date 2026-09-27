import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
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
import type { MfaEnrollment, MfaFactor, MFAStore } from './types';

const ID_LENGTH = 255;
const PHONE_LENGTH = 20;

export const mfaEnrollmentsTable = pgTable('auth_mfa_enrollments', {
	backup_code_hashes: jsonb('backup_code_hashes')
		.$type<string[]>()
		.notNull()
		.default([]),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	last_used_at_ms: bigint('last_used_at_ms', { mode: 'number' }),
	mfa_factors: jsonb('mfa_factors').$type<MfaFactor[]>(),
	sms_challenge_id: text('sms_challenge_id'),
	sms_code_sent_at_ms: bigint('sms_code_sent_at_ms', { mode: 'number' }),
	sms_failed_attempts: smallint('sms_failed_attempts').notNull().default(0),
	sms_pending_code_expires_at_ms: bigint('sms_pending_code_expires_at_ms', {
		mode: 'number'
	}),
	sms_pending_code_hash: text('sms_pending_code_hash'),
	sms_pending_factor_id: text('sms_pending_factor_id'),
	sms_pending_purpose: text('sms_pending_purpose').$type<
		MfaEnrollment['smsPendingPurpose']
	>(),
	sms_phone: varchar('sms_phone', { length: PHONE_LENGTH }),
	sms_provider_reference: text('sms_provider_reference'),
	sms_verified: boolean('sms_verified').notNull().default(false),
	totp_failed_attempts: smallint('totp_failed_attempts').notNull().default(0),
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
	factors: row.mfa_factors ?? undefined,
	lastUsedAt: row.last_used_at_ms ?? undefined,
	smsChallengeId: row.sms_challenge_id ?? undefined,
	smsCodeSentAt: row.sms_code_sent_at_ms ?? undefined,
	smsFailedAttempts: row.sms_failed_attempts,
	smsPendingCodeExpiresAt: row.sms_pending_code_expires_at_ms ?? undefined,
	smsPendingCodeHash: row.sms_pending_code_hash ?? undefined,
	smsPendingFactorId: row.sms_pending_factor_id ?? undefined,
	smsPendingPurpose: row.sms_pending_purpose ?? undefined,
	smsPhone: row.sms_phone ?? undefined,
	smsProviderReference: row.sms_provider_reference ?? undefined,
	smsVerified: row.sms_verified,
	totpFailedAttempts: row.totp_failed_attempts,
	totpSecretCiphertext: row.totp_secret_ciphertext ?? undefined,
	totpVerified: row.totp_verified,
	updatedAt: row.updated_at_ms,
	userId: row.user_id
});

export const createNeonMfaStore = (databaseUrl: string) =>
	createPostgresMfaStore(createNeonDatabase(databaseUrl));
export const createPostgresMfaStore = <DB extends AnyPgDatabase>(
	db: DB
): MFAStore => {
	const toValues = (enrollment: MfaEnrollment): MfaInsert => ({
		backup_code_hashes: enrollment.backupCodeHashes,
		created_at_ms: enrollment.createdAt,
		last_used_at_ms: enrollment.lastUsedAt ?? null,
		mfa_factors: enrollment.factors ?? null,
		sms_challenge_id: enrollment.smsChallengeId ?? null,
		sms_code_sent_at_ms: enrollment.smsCodeSentAt ?? null,
		sms_failed_attempts: enrollment.smsFailedAttempts ?? 0,
		sms_pending_code_expires_at_ms:
			enrollment.smsPendingCodeExpiresAt ?? null,
		sms_pending_code_hash: enrollment.smsPendingCodeHash ?? null,
		sms_pending_factor_id: enrollment.smsPendingFactorId ?? null,
		sms_pending_purpose: enrollment.smsPendingPurpose ?? null,
		sms_phone: enrollment.smsPhone ?? null,
		sms_provider_reference: enrollment.smsProviderReference ?? null,
		sms_verified: enrollment.smsVerified,
		totp_failed_attempts: enrollment.totpFailedAttempts ?? 0,
		totp_secret_ciphertext: enrollment.totpSecretCiphertext ?? null,
		totp_verified: enrollment.totpVerified,
		updated_at_ms: enrollment.updatedAt,
		user_id: enrollment.userId
	});

	return {
		claimSmsChallenge: async ({
			challengeId,
			cooldownCutoff,
			enrollment
		}) => {
			const values = toValues({
				...enrollment,
				smsChallengeId: challengeId
			});
			const rows = await db
				.insert(mfaEnrollmentsTable)
				.values(values)
				.onConflictDoUpdate({
					set: {
						mfa_factors: enrollment.factors ?? null,
						sms_challenge_id: challengeId,
						sms_code_sent_at_ms: enrollment.smsCodeSentAt ?? null,
						sms_failed_attempts: 0,
						sms_pending_code_expires_at_ms:
							enrollment.smsPendingCodeExpiresAt ?? null,
						sms_pending_code_hash: null,
						sms_pending_factor_id:
							enrollment.smsPendingFactorId ?? null,
						sms_pending_purpose:
							enrollment.smsPendingPurpose ?? null,
						sms_phone: enrollment.smsPhone ?? null,
						sms_provider_reference: null,
						sms_verified: enrollment.smsVerified,
						updated_at_ms: enrollment.updatedAt
					},
					setWhere: or(
						isNull(mfaEnrollmentsTable.sms_code_sent_at_ms),
						lte(
							mfaEnrollmentsTable.sms_code_sent_at_ms,
							cooldownCutoff
						)
					),
					target: mfaEnrollmentsTable.user_id
				})
				.returning({ userId: mfaEnrollmentsTable.user_id });

			return rows.length === 1;
		},
		completeSmsChallenge: async ({
			challengeId,
			factors,
			lastUsedAt,
			smsVerified,
			userId
		}) => {
			const rows = await db
				.update(mfaEnrollmentsTable)
				.set({
					last_used_at_ms: lastUsedAt,
					mfa_factors: factors,
					sms_challenge_id: null,
					sms_failed_attempts: 0,
					sms_pending_code_expires_at_ms: null,
					sms_pending_code_hash: null,
					sms_pending_factor_id: null,
					sms_pending_purpose: null,
					sms_provider_reference: null,
					sms_verified: smsVerified,
					updated_at_ms: Date.now()
				})
				.where(
					and(
						eq(mfaEnrollmentsTable.user_id, userId),
						eq(mfaEnrollmentsTable.sms_challenge_id, challengeId)
					)
				)
				.returning({ userId: mfaEnrollmentsTable.user_id });

			return rows.length === 1;
		},
		finalizeSmsChallenge: async (input) => {
			const rows = await db
				.update(mfaEnrollmentsTable)
				.set({
					sms_pending_code_expires_at_ms: input.expiresAt,
					sms_pending_code_hash: input.hash ?? null,
					sms_provider_reference: input.providerReference ?? null,
					updated_at_ms: Date.now()
				})
				.where(
					and(
						eq(mfaEnrollmentsTable.user_id, input.userId),
						eq(
							mfaEnrollmentsTable.sms_challenge_id,
							input.challengeId
						)
					)
				)
				.returning({ userId: mfaEnrollmentsTable.user_id });

			return rows.length === 1;
		},
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
		recordSmsFailure: async ({ challengeId, maxAttempts, userId }) => {
			const rows = await db
				.update(mfaEnrollmentsTable)
				.set({
					sms_failed_attempts: sql`${mfaEnrollmentsTable.sms_failed_attempts} + 1`,
					updated_at_ms: Date.now()
				})
				.where(
					and(
						eq(mfaEnrollmentsTable.user_id, userId),
						eq(mfaEnrollmentsTable.sms_challenge_id, challengeId),
						lte(
							mfaEnrollmentsTable.sms_failed_attempts,
							maxAttempts - 1
						)
					)
				)
				.returning({
					attempts: mfaEnrollmentsTable.sms_failed_attempts
				});

			return rows[0]?.attempts;
		},
		removeEnrollment: async (userId) => {
			await db
				.delete(mfaEnrollmentsTable)
				.where(eq(mfaEnrollmentsTable.user_id, userId));
		},
		rollbackSmsChallenge: async ({ challengeId, previous, userId }) => {
			if (previous) {
				await db
					.update(mfaEnrollmentsTable)
					.set(toValues(previous))
					.where(
						and(
							eq(mfaEnrollmentsTable.user_id, userId),
							eq(
								mfaEnrollmentsTable.sms_challenge_id,
								challengeId
							)
						)
					);

				return;
			}
			await db
				.delete(mfaEnrollmentsTable)
				.where(
					and(
						eq(mfaEnrollmentsTable.user_id, userId),
						eq(mfaEnrollmentsTable.sms_challenge_id, challengeId)
					)
				);
		},
		saveEnrollment: async (enrollment) => {
			const values = toValues(enrollment);
			await db
				.insert(mfaEnrollmentsTable)
				.values(values)
				.onConflictDoUpdate({
					set: values,
					target: mfaEnrollmentsTable.user_id
				});
		}
	};
};
