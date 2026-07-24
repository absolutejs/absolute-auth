import type {
	SessionData,
	UnregisteredSessionData,
	UserSessionId
} from '../types';

export type SessionUserDecoder<UserType> = (value: unknown) => UserType;

export const decodeSessionUserRecord = (value: unknown) => {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('Persisted session user must be an object');

	return value;
};

export type AuthSessionStore<UserType> = {
	getSession: (
		id: UserSessionId
	) => Promise<SessionData<UserType> | undefined>;
	setSession: (
		id: UserSessionId,
		value: SessionData<UserType>
	) => Promise<void>;
	removeSession: (id: UserSessionId) => Promise<void>;
	getUnregisteredSession: (
		id: UserSessionId
	) => Promise<UnregisteredSessionData | undefined>;
	setUnregisteredSession: (
		id: UserSessionId,
		value: UnregisteredSessionData
	) => Promise<void>;
	removeUnregisteredSession: (id: UserSessionId) => Promise<void>;
	listSessionIds?: () => Promise<UserSessionId[]>;
	listUnregisteredSessionIds?: () => Promise<UserSessionId[]>;
	/**
	 * Optional fast-path the periodic cleanup prefers over loading every session
	 * to check expiry: a backing store (e.g. SQL) deletes all rows past their
	 * expiry in one indexed statement and returns how many it removed. When a
	 * store provides this, cleanup skips the `listSessionIds` + per-id load
	 * storm entirely. (Per-user session caps stay a creation-time concern.)
	 */
	deleteExpired?: () => Promise<number>;
	deleteExpiredUnregistered?: () => Promise<number>;
};

export type AuthSessionSource<UserType> = Pick<
	AuthSessionStore<UserType>,
	'getSession' | 'removeSession'
>;
