import { Elysia } from 'elysia';
import { DEFAULT_MAX_SESSIONS, MILLISECONDS_IN_AN_HOUR } from './constants';
import { sessionStore } from './sessionStore';
import type { AbsoluteAuthSessionStore } from './sessionTypes';
import { isUserSessionId } from './typeGuards';
import type {
	OnSessionCleanup,
	SessionData,
	SessionRecord,
	UnregisteredSessionData,
	UnregisteredSessionRecord,
	UserSessionId
} from './types';

type SessionCleanupProps<UserType> = {
	authSessionStore?: AbsoluteAuthSessionStore<UserType>;
	cleanupIntervalMs?: number;
	maxSessions?: number;
	onSessionCleanup?: OnSessionCleanup<UserType>;
};

export const sessionCleanup = <UserType>({
	authSessionStore,
	cleanupIntervalMs = MILLISECONDS_IN_AN_HOUR,
	maxSessions = DEFAULT_MAX_SESSIONS,
	onSessionCleanup
}: SessionCleanupProps<UserType>) => {
	let intervalId: ReturnType<typeof setInterval> | null = null;

	return new Elysia({ name: 'sessionCleanup' })
		.use(sessionStore<UserType>())
		.onStart(({ store: { session, unregisteredSession } }) => {
			intervalId = setInterval(async () => {
				await performCleanup({
					authSessionStore,
					maxSessions,
					onSessionCleanup,
					session,
					unregisteredSession
				});
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
				await performCleanup({
					authSessionStore,
					maxSessions,
					onSessionCleanup,
					session,
					unregisteredSession
				});
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

const performRecordCleanup = async <UserType>({
	maxSessions,
	onSessionCleanup,
	session,
	unregisteredSession
}: {
	maxSessions: number;
	onSessionCleanup?: OnSessionCleanup<UserType>;
	session: SessionRecord<UserType>;
	unregisteredSession: UnregisteredSessionRecord;
}) => {
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

const loadStoreSessions = async <UserType>(
	authSessionStore: AbsoluteAuthSessionStore<UserType>
) => {
	const sessionIds = await authSessionStore.listSessionIds?.();
	if (!sessionIds) return null;

	const entries: [UserSessionId, SessionData<UserType>][] = [];
	for (const sessionId of sessionIds) {
		const session = await authSessionStore.getSession(sessionId);
		if (session) entries.push([sessionId, session]);
	}

	return entries;
};

const loadStoreUnregisteredSessions = async <UserType>(
	authSessionStore: AbsoluteAuthSessionStore<UserType>
) => {
	const sessionIds = await authSessionStore.listUnregisteredSessionIds?.();
	if (!sessionIds) return null;

	const entries: [UserSessionId, UnregisteredSessionData][] = [];
	for (const sessionId of sessionIds) {
		const session =
			await authSessionStore.getUnregisteredSession(sessionId);
		if (session) entries.push([sessionId, session]);
	}

	return entries;
};

const performStoreCleanup = async <UserType>({
	authSessionStore,
	maxSessions,
	onSessionCleanup
}: {
	authSessionStore: AbsoluteAuthSessionStore<UserType>;
	maxSessions: number;
	onSessionCleanup?: OnSessionCleanup<UserType>;
}) => {
	const now = Date.now();
	const sessionEntries = await loadStoreSessions(authSessionStore);
	const unregisteredEntries =
		await loadStoreUnregisteredSessions(authSessionStore);
	if (!sessionEntries || !unregisteredEntries) {
		return;
	}

	const removedSessions = new Map<UserSessionId, SessionData<UserType>>();
	const removedUnregisteredSessions = new Map<
		UserSessionId,
		UnregisteredSessionData
	>();

	const remainingSessions = sessionEntries.filter(([sessionId, session]) => {
		if (session.expiresAt >= now) return true;
		removedSessions.set(sessionId, session);
		return false;
	});
	for (const sessionId of removedSessions.keys()) {
		await authSessionStore.removeSession(sessionId);
	}

	const remainingUnregistered = unregisteredEntries.filter(
		([sessionId, session]) => {
			if (session.expiresAt >= now) return true;
			removedUnregisteredSessions.set(sessionId, session);
			return false;
		}
	);
	for (const sessionId of removedUnregisteredSessions.keys()) {
		await authSessionStore.removeUnregisteredSession(sessionId);
	}

	if (remainingSessions.length > maxSessions) {
		const overflow = [...remainingSessions]
			.sort(([, left], [, right]) => left.expiresAt - right.expiresAt)
			.slice(0, remainingSessions.length - maxSessions);
		for (const [sessionId, session] of overflow) {
			removedSessions.set(sessionId, session);
			await authSessionStore.removeSession(sessionId);
		}
	}

	if (remainingUnregistered.length > maxSessions) {
		const overflow = [...remainingUnregistered]
			.sort(([, left], [, right]) => left.expiresAt - right.expiresAt)
			.slice(0, remainingUnregistered.length - maxSessions);
		for (const [sessionId, session] of overflow) {
			removedUnregisteredSessions.set(sessionId, session);
			await authSessionStore.removeUnregisteredSession(sessionId);
		}
	}

	try {
		await onSessionCleanup?.({
			removedSessions,
			removedUnregisteredSessions
		});
	} catch (err) {
		console.error('[sessionCleanup] onSessionCleanup handler failed:', err);
	}
};

const performCleanup = async <UserType>({
	authSessionStore,
	maxSessions,
	onSessionCleanup,
	session,
	unregisteredSession
}: {
	authSessionStore?: AbsoluteAuthSessionStore<UserType>;
	maxSessions: number;
	onSessionCleanup?: OnSessionCleanup<UserType>;
	session: SessionRecord<UserType>;
	unregisteredSession: UnregisteredSessionRecord;
}) => {
	if (authSessionStore) {
		await performStoreCleanup({
			authSessionStore,
			maxSessions,
			onSessionCleanup
		});
		return;
	}

	await performRecordCleanup({
		maxSessions,
		onSessionCleanup,
		session,
		unregisteredSession
	});
};
