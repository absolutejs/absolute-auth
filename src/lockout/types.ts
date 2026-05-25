export type LockoutRecord = {
	failedAttempts: number;
	key: string;
	lockedUntil?: number;
	windowStartedAt: number;
};

// Keyed attempt counters (per identity and/or per IP). The threshold/backoff policy
// lives in `createLockoutGuard`; the store is just durable counters.
export type LockoutStore = {
	get: (key: string) => Promise<LockoutRecord | undefined>;
	increment: (key: string, windowMs: number) => Promise<LockoutRecord>;
	lock: (key: string, lockedUntil: number) => Promise<void>;
	reset: (key: string) => Promise<void>;
};
