import type { MfaEnrollment, MFAStore } from './types';

const cloneEnrollment = (value: MfaEnrollment): MfaEnrollment => ({
	...value,
	backupCodeHashes: [...value.backupCodeHashes]
});

export const createInMemoryMfaStore = (): MFAStore => {
	const enrollments = new Map<string, MfaEnrollment>();

	return {
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
		completeSmsChallenge: async ({
			challengeId,
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
					lastUsedAt: lastUsedAt ?? current.lastUsedAt,
					smsChallengeId: undefined,
					smsFailedAttempts: 0,
					smsPendingCodeExpiresAt: undefined,
					smsPendingCodeHash: undefined,
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
		},
		rollbackSmsChallenge: async ({ challengeId, previous, userId }) => {
			if (enrollments.get(userId)?.smsChallengeId !== challengeId) return;
			if (previous) enrollments.set(userId, cloneEnrollment(previous));
			else enrollments.delete(userId);
		},
		saveEnrollment: async (enrollment) => {
			enrollments.set(enrollment.userId, cloneEnrollment(enrollment));
		}
	};
};
