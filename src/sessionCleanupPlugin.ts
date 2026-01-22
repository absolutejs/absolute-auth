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

export const sessionCleanupPlugin = <UserType>({
	cleanupIntervalMs = MILLISECONDS_IN_AN_HOUR,
	maxSessions = DEFAULT_MAX_SESSIONS,
	onSessionCleanup
}: {
	cleanupIntervalMs?: number;
	maxSessions?: number;
	onSessionCleanup?: OnSessionCleanup<UserType>;
}) => {
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

const performCleanup = async <UserType>(
	session: SessionRecord<UserType>,
	unregisteredSession: UnregisteredSessionRecord,
	maxSessions: number,
	onSessionCleanup?: OnSessionCleanup<UserType>
) => {
	const now = Date.now();
	const removedSessions = new Map<UserSessionId, SessionData<UserType>>();
	const removedUnregisteredSessions = new Map<
		UserSessionId,
		UnregisteredSessionData
	>();

	const validSessionEntries: [UserSessionId, SessionData<UserType>][] = [];
	for (const [key, value] of Object.entries(session)) {
		if (isUserSessionId(key)) {
			validSessionEntries.push([key, value]);
		}
	}

	for (const [sessionId, userSession] of validSessionEntries) {
		if (userSession.expiresAt < now) {
			removedSessions.set(sessionId, userSession);
			delete session[sessionId];
		}
	}

	const validUnregisteredEntries: [UserSessionId, UnregisteredSessionData][] =
		[];
	for (const [key, value] of Object.entries(unregisteredSession)) {
		if (isUserSessionId(key)) {
			validUnregisteredEntries.push([key, value]);
		}
	}

	for (const [sessionId, unregSession] of validUnregisteredEntries) {
		if (unregSession.expiresAt < now) {
			removedUnregisteredSessions.set(sessionId, unregSession);
			delete unregisteredSession[sessionId];
		}
	}

	const remainingEntries = validSessionEntries.filter(
		([key]) => !removedSessions.has(key)
	);
	const excessSessions = remainingEntries.length - maxSessions;

	if (excessSessions > 0) {
		const sortedByExpiry = remainingEntries.sort(
			([, entryA], [, entryB]) => entryA.expiresAt - entryB.expiresAt
		);
		const toEvict = sortedByExpiry.slice(0, excessSessions);

		for (const [key, value] of toEvict) {
			removedSessions.set(key, value);
			delete session[key];
		}
	}

	const remainingUnregistered = validUnregisteredEntries.filter(
		([key]) => !removedUnregisteredSessions.has(key)
	);
	const excessUnregistered = remainingUnregistered.length - maxSessions;

	if (excessUnregistered > 0) {
		const sortedByExpiry = remainingUnregistered.sort(
			([, entryA], [, entryB]) => entryA.expiresAt - entryB.expiresAt
		);
		const toEvict = sortedByExpiry.slice(0, excessUnregistered);

		for (const [key, value] of toEvict) {
			removedUnregisteredSessions.set(key, value);
			delete unregisteredSession[key];
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
