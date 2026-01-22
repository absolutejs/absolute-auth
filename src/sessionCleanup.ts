import { Elysia } from 'elysia';
import { DEFAULT_MAX_SESSIONS, MILLISECONDS_IN_AN_HOUR } from './constants';
import { sessionStore } from './sessionStore';
import { isUserSessionId } from './typeGuards';
import {
	OnSessionCleanup,
	SessionData,
	SessionRecord,
	UnregisteredSessionData,
	UnregisteredSessionRecord,
	UserSessionId
} from './types';

type SessionCleanupProps<UserType> = {
	cleanupIntervalMs?: number;
	maxSessions?: number;
	onSessionCleanup?: OnSessionCleanup<UserType>;
};

export const sessionCleanup = <UserType>({
	cleanupIntervalMs = MILLISECONDS_IN_AN_HOUR,
	maxSessions = DEFAULT_MAX_SESSIONS,
	onSessionCleanup
}: SessionCleanupProps<UserType>) => {
	let intervalId: ReturnType<typeof setInterval> | null = null;

	return new Elysia({ name: 'sessionCleanup' })
		.use(sessionStore<UserType>())
		.onStart(({ store: { session, unregisteredSession } }) => {
			intervalId = setInterval(async () => {
				await performCleanup(
					session,
					unregisteredSession,
					maxSessions,
					onSessionCleanup
				);
			}, cleanupIntervalMs);
		})
		.onStop(() => {
			if (intervalId) {
				clearInterval(intervalId);
				intervalId = null;
			}
		})
		.derive(({ store: { session, unregisteredSession } }) => ({
			cleanupSessions: async () => {
				await performCleanup(
					session,
					unregisteredSession,
					maxSessions,
					onSessionCleanup
				);
			}
		}))
		.as('global');
};

const collectValidSessionEntries = <UserType>(
	session: SessionRecord<UserType>
) => {
	const entries: [UserSessionId, SessionData<UserType>][] = [];
	for (const [key, value] of Object.entries(session)) {
		if (!isUserSessionId(key)) continue;
		entries.push([key, value]);
	}

	return entries;
};

const collectValidUnregisteredEntries = (
	unregisteredSession: UnregisteredSessionRecord
) => {
	const entries: [UserSessionId, UnregisteredSessionData][] = [];
	for (const [key, value] of Object.entries(unregisteredSession)) {
		if (!isUserSessionId(key)) continue;
		entries.push([key, value]);
	}

	return entries;
};

const removeExpiredSessions = <UserType>(
	validEntries: [UserSessionId, SessionData<UserType>][],
	session: SessionRecord<UserType>,
	now: number
) => {
	const removed = new Map<UserSessionId, SessionData<UserType>>();
	for (const [sessionId, userSession] of validEntries) {
		if (userSession.expiresAt >= now) continue;
		removed.set(sessionId, userSession);
		delete session[sessionId];
	}

	return removed;
};

const removeExpiredUnregisteredSessions = (
	validEntries: [UserSessionId, UnregisteredSessionData][],
	unregisteredSession: UnregisteredSessionRecord,
	now: number
) => {
	const removed = new Map<UserSessionId, UnregisteredSessionData>();
	for (const [sessionId, unregSession] of validEntries) {
		if (unregSession.expiresAt >= now) continue;
		removed.set(sessionId, unregSession);
		delete unregisteredSession[sessionId];
	}

	return removed;
};

const evictExcessSessions = <UserType>(
	remainingEntries: [UserSessionId, SessionData<UserType>][],
	session: SessionRecord<UserType>,
	maxSessions: number,
	removedSessions: Map<UserSessionId, SessionData<UserType>>
) => {
	const excessCount = remainingEntries.length - maxSessions;
	if (excessCount <= 0) return;

	const sortedByExpiry = remainingEntries.sort(
		([, entryA], [, entryB]) => entryA.expiresAt - entryB.expiresAt
	);
	const toEvict = sortedByExpiry.slice(0, excessCount);

	for (const [key, value] of toEvict) {
		removedSessions.set(key, value);
		delete session[key];
	}
};

const evictExcessUnregisteredSessions = (
	remainingEntries: [UserSessionId, UnregisteredSessionData][],
	unregisteredSession: UnregisteredSessionRecord,
	maxSessions: number,
	removedUnregisteredSessions: Map<UserSessionId, UnregisteredSessionData>
) => {
	const excessCount = remainingEntries.length - maxSessions;
	if (excessCount <= 0) return;

	const sortedByExpiry = remainingEntries.sort(
		([, entryA], [, entryB]) => entryA.expiresAt - entryB.expiresAt
	);
	const toEvict = sortedByExpiry.slice(0, excessCount);

	for (const [key, value] of toEvict) {
		removedUnregisteredSessions.set(key, value);
		delete unregisteredSession[key];
	}
};

const performCleanup = async <UserType>(
	session: SessionRecord<UserType>,
	unregisteredSession: UnregisteredSessionRecord,
	maxSessions: number,
	onSessionCleanup?: OnSessionCleanup<UserType>
) => {
	const now = Date.now();

	const validSessionEntries = collectValidSessionEntries(session);
	const removedSessions = removeExpiredSessions(
		validSessionEntries,
		session,
		now
	);

	const validUnregisteredEntries =
		collectValidUnregisteredEntries(unregisteredSession);
	const removedUnregisteredSessions = removeExpiredUnregisteredSessions(
		validUnregisteredEntries,
		unregisteredSession,
		now
	);

	const remainingEntries = validSessionEntries.filter(
		([key]) => !removedSessions.has(key)
	);
	evictExcessSessions(
		remainingEntries,
		session,
		maxSessions,
		removedSessions
	);

	const remainingUnregistered = validUnregisteredEntries.filter(
		([key]) => !removedUnregisteredSessions.has(key)
	);
	evictExcessUnregisteredSessions(
		remainingUnregistered,
		unregisteredSession,
		maxSessions,
		removedUnregisteredSessions
	);

	try {
		await onSessionCleanup?.({
			removedSessions,
			removedUnregisteredSessions
		});
	} catch (err) {
		console.error('[sessionCleanup] onSessionCleanup handler failed:', err);
	}
};
