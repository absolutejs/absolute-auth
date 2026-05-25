import type { MfaEnrollment, MFAStore } from './types';

const cloneEnrollment = (value: MfaEnrollment): MfaEnrollment => ({
	...value,
	backupCodeHashes: [...value.backupCodeHashes]
});

export const createInMemoryMfaStore = (): MFAStore => {
	const enrollments = new Map<string, MfaEnrollment>();

	return {
		getEnrollment: async (userId) => {
			const enrollment = enrollments.get(userId);

			return enrollment ? cloneEnrollment(enrollment) : undefined;
		},
		listEnrollments: async () =>
			Array.from(enrollments.values()).map(cloneEnrollment),
		removeEnrollment: async (userId) => {
			enrollments.delete(userId);
		},
		saveEnrollment: async (enrollment) => {
			enrollments.set(enrollment.userId, cloneEnrollment(enrollment));
		}
	};
};
