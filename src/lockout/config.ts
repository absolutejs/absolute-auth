import { MILLISECONDS_IN_A_MINUTE } from '../constants';
import type { LockoutStore } from './types';

const DEFAULT_MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 15;
const DEFAULT_WINDOW_MS = MILLISECONDS_IN_A_MINUTE * LOCKOUT_WINDOW_MINUTES;
const DEFAULT_LOCKOUT_MS = MILLISECONDS_IN_A_MINUTE * LOCKOUT_WINDOW_MINUTES;

export type LockoutConfig = {
	lockoutStore: LockoutStore;
	lockoutMs?: number;
	maxAttempts?: number;
	windowMs?: number;
};

export type LockoutState = {
	locked: boolean;
	retryAfterMs?: number;
};

export type LockoutGuard = {
	check: (key: string) => Promise<LockoutState>;
	recordFailure: (key: string) => Promise<void>;
	recordSuccess: (key: string) => Promise<void>;
};

export const createLockoutGuard = ({
	lockoutMs = DEFAULT_LOCKOUT_MS,
	lockoutStore,
	maxAttempts = DEFAULT_MAX_ATTEMPTS,
	windowMs = DEFAULT_WINDOW_MS
}: LockoutConfig): LockoutGuard => ({
	check: async (key) => {
		const record = await lockoutStore.get(key);
		const retryAfterMs = (record?.lockedUntil ?? 0) - Date.now();

		return retryAfterMs > 0
			? { locked: true, retryAfterMs }
			: { locked: false };
	},
	recordFailure: async (key) => {
		const record = await lockoutStore.increment(key, windowMs);
		if (record.failedAttempts >= maxAttempts) {
			await lockoutStore.lock(key, Date.now() + lockoutMs);
		}
	},
	recordSuccess: async (key) => {
		await lockoutStore.reset(key);
	}
});
