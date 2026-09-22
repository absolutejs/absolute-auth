import type { MfaEnrollment, MFAStore, MfaAttempt } from './types';

const cloneEnrollment = (value: MfaEnrollment): MfaEnrollment => ({
	...value,
	backupCodeHashes: [...value.backupCodeHashes],
	factors: value.factors?.map((factor) => ({ ...factor }))
});

export const createInMemoryMfaStore = (): MFAStore => {
	const enrollments = new Map<string, MfaEnrollment>();
	const codeAttempts = new Map<string, MfaAttempt>();

	return {
		claimCodeAttempt: async ({
			userId,
			factor,
			maxAttempts,
			windowMs,
			now
		}) => {
			const key = JSON.stringify([userId, factor]);
			const previous = codeAttempts.get(key);
			const current: Pick<MfaAttempt, 'attempts' | 'windowStartedAt'> =
				previous && now < previous.windowStartedAt + windowMs
					? previous
					: { attempts: 0, windowStartedAt: now };
			const allowed = current.attempts < maxAttempts;
			const result: MfaAttempt = {
				allowed,
				attempts: current.attempts + (allowed ? 1 : 0),
				retryAfterMs: Math.max(
					0,
					current.windowStartedAt + windowMs - now
				),
				windowStartedAt: current.windowStartedAt
			};
			codeAttempts.set(key, result);

			return { ...result };
		},
		claimSmsChallenge: async ({
			challengeId,
			cooldownCutoff,
			enrollment
		}) => {
			const current = enrollments.get(enrollment.userId);
			if (
				current?.smsCodeSentAt !== undefined &&
				current.smsCodeSentAt > cooldownCutoff
			) {
				return false;
			}
			enrollments.set(
				enrollment.userId,
				cloneEnrollment({
					...enrollment,
					smsChallengeId: challengeId
				})
			);

			return true;
		},
		completeCodeChallenge: async ({ userId, backupCodeHash, now }) => {
			const current = enrollments.get(userId);
			if (
				!current ||
				(backupCodeHash !== undefined &&
					!current.backupCodeHashes.includes(backupCodeHash))
			)
				return false;
			enrollments.set(
				userId,
				cloneEnrollment({
					...current,
					backupCodeHashes:
						backupCodeHash === undefined
							? current.backupCodeHashes
							: current.backupCodeHashes.filter(
									(hash) => hash !== backupCodeHash
								),
					lastUsedAt: now,
					totpFailedAttempts: 0,
					updatedAt: now
				})
			);

			return true;
		},
		completeSmsChallenge: async ({
			challengeId,
			factors,
			lastUsedAt,
			smsVerified,
			userId
		}) => {
			const current = enrollments.get(userId);
			if (current?.smsChallengeId !== challengeId) return false;
			enrollments.set(
				userId,
				cloneEnrollment({
					...current,
					factors: factors ?? current.factors,
					lastUsedAt: lastUsedAt ?? current.lastUsedAt,
					smsChallengeId: undefined,
					smsFailedAttempts: 0,
					smsPendingCodeExpiresAt: undefined,
					smsPendingCodeHash: undefined,
					smsPendingFactorId: undefined,
					smsPendingPurpose: undefined,
					smsProviderReference: undefined,
					smsVerified,
					updatedAt: Date.now()
				})
			);

			return true;
		},
		finalizeSmsChallenge: async (input) => {
			const current = enrollments.get(input.userId);
			if (current?.smsChallengeId !== input.challengeId) return false;
			enrollments.set(
				input.userId,
				cloneEnrollment({
					...current,
					smsPendingCodeExpiresAt: input.expiresAt,
					smsPendingCodeHash: input.hash,
					smsProviderReference: input.providerReference,
					updatedAt: Date.now()
				})
			);

			return true;
		},
		getEnrollment: async (userId) => {
			const enrollment = enrollments.get(userId);

			return enrollment ? cloneEnrollment(enrollment) : undefined;
		},
		listEnrollments: async () =>
			Array.from(enrollments.values()).map(cloneEnrollment),
		recordSmsFailure: async ({ challengeId, maxAttempts, userId }) => {
			const current = enrollments.get(userId);
			if (
				current?.smsChallengeId !== challengeId ||
				(current.smsFailedAttempts ?? 0) >= maxAttempts
			)
				return undefined;
			const attempts = (current.smsFailedAttempts ?? 0) + 1;
			enrollments.set(
				userId,
				cloneEnrollment({
					...current,
					smsFailedAttempts: attempts,
					updatedAt: Date.now()
				})
			);

			return attempts;
		},
		removeEnrollment: async (userId) => {
			enrollments.delete(userId);
			codeAttempts.delete(JSON.stringify([userId, 'totp']));
			codeAttempts.delete(JSON.stringify([userId, 'backup_codes']));
		},
		resetCodeAttempts: async ({ userId, factor, attempt }) => {
			const key = JSON.stringify([userId, factor]);
			const current = codeAttempts.get(key);
			if (
				current?.windowStartedAt === attempt.windowStartedAt &&
				current.attempts === attempt.attempts
			)
				codeAttempts.delete(key);
		},
		rollbackSmsChallenge: async ({ challengeId, previous, userId }) => {
			if (enrollments.get(userId)?.smsChallengeId !== challengeId) return;
			if (previous) enrollments.set(userId, cloneEnrollment(previous));
			else enrollments.delete(userId);
			codeAttempts.delete(JSON.stringify([userId, 'totp']));
			codeAttempts.delete(JSON.stringify([userId, 'backup_codes']));
		},
		saveEnrollment: async (enrollment) => {
			enrollments.set(enrollment.userId, cloneEnrollment(enrollment));
		},
		saveTotpEnrollment: async ({ expected, enrollment }) => {
			const current = enrollments.get(enrollment.userId);
			if (
				JSON.stringify(current?.factors) !==
					JSON.stringify(expected?.factors) ||
				JSON.stringify(current?.backupCodeHashes) !==
					JSON.stringify(expected?.backupCodeHashes) ||
				current?.totpSecretCiphertext !==
					expected?.totpSecretCiphertext ||
				current?.totpVerified !== expected?.totpVerified
			)
				return false;
			enrollments.set(
				enrollment.userId,
				cloneEnrollment(
					current
						? {
								...current,
								backupCodeHashes: enrollment.backupCodeHashes,
								factors: enrollment.factors,
								totpSecretCiphertext:
									enrollment.totpSecretCiphertext,
								totpVerified: enrollment.totpVerified,
								updatedAt: enrollment.updatedAt
							}
						: enrollment
				)
			);

			return true;
		}
	};
};
