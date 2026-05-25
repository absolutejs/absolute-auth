import type { LockoutRecord, LockoutStore } from './types';

const cloneRecord = (value: LockoutRecord): LockoutRecord => ({ ...value });

export const createInMemoryLockoutStore = (): LockoutStore => {
	const records = new Map<string, LockoutRecord>();

	return {
		get: async (key) => {
			const record = records.get(key);

			return record ? cloneRecord(record) : undefined;
		},
		increment: async (key, windowMs) => {
			const now = Date.now();
			const existing = records.get(key);
			const next: LockoutRecord =
				existing !== undefined &&
				now - existing.windowStartedAt <= windowMs
					? { ...existing, failedAttempts: existing.failedAttempts + 1 }
					: { failedAttempts: 1, key, windowStartedAt: now };
			records.set(key, next);

			return cloneRecord(next);
		},
		lock: async (key, lockedUntil) => {
			const existing = records.get(key) ?? {
				failedAttempts: 0,
				key,
				windowStartedAt: Date.now()
			};
			records.set(key, { ...existing, lockedUntil });
		},
		reset: async (key) => {
			records.delete(key);
		}
	};
};
