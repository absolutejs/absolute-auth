import type { Cookie } from 'elysia';
import type { AuthSessionStore } from './sessionTypes';
import { isUserSessionId } from './typeGuards';
import type {
	SessionData,
	SessionRecord,
	UnregisteredSessionData,
	UnregisteredSessionRecord,
	UserSessionId
} from './types';

const collectSessionEntries = <UserType>(
	session: SessionRecord<UserType>
): [UserSessionId, SessionData<UserType>][] => {
	const entries: [UserSessionId, SessionData<UserType>][] = [];
	for (const [key, value] of Object.entries(session)) {
		if (!isUserSessionId(key)) continue;
		entries.push([key, value]);
	}

	return entries;
};

const collectUnregisteredEntries = (
	unregisteredSession: UnregisteredSessionRecord
): [UserSessionId, UnregisteredSessionData][] => {
	const entries: [UserSessionId, UnregisteredSessionData][] = [];
	for (const [key, value] of Object.entries(unregisteredSession)) {
		if (!isUserSessionId(key)) continue;
		entries.push([key, value]);
	}

	return entries;
};

export const loadSessionFromSource = async <UserType>({
	authSessionStore,
	session,
	userSessionId,
	removeExpired = true
}: {
	authSessionStore?: AuthSessionStore<UserType>;
	session?: SessionRecord<UserType>;
	userSessionId?: UserSessionId;
	removeExpired?: boolean;
}): Promise<SessionData<UserType> | undefined> => {
	if (!userSessionId) return undefined;

	const userSession = authSessionStore
		? await authSessionStore.getSession(userSessionId)
		: session?.[userSessionId];
	if (!userSession) return undefined;

	if (removeExpired && userSession.expiresAt < Date.now()) {
		if (authSessionStore) {
			await authSessionStore.removeSession(userSessionId);
		} else if (session) {
			delete session[userSessionId];
		}

		return undefined;
	}

	return userSession;
};

export const getStatusFromSource = async <UserType>({
	authSessionStore,
	session,
	user_session_id
}: {
	authSessionStore?: AuthSessionStore<UserType>;
	session?: SessionRecord<UserType>;
	user_session_id: Cookie<UserSessionId | undefined>;
}) => {
	if (user_session_id === undefined) {
		return {
			error: {
				code: 'Bad Request',
				message: 'Cookies are missing'
			} as const,
			user: null
		};
	}

	const userSessionId = user_session_id.value;
	const userSession = await loadSessionFromSource({
		authSessionStore,
		session,
		userSessionId
	});

	if (!userSession && userSessionId) {
		user_session_id.remove();
	}

	return {
		error: null,
		user: userSession?.user ?? null
	};
};

export const createSessionCompatibilityLayer = async <UserType>({
	authSessionStore,
	userSessionId
}: {
	authSessionStore?: AuthSessionStore<UserType>;
	userSessionId?: UserSessionId;
}): Promise<{
	session: SessionRecord<UserType>;
	unregisteredSession: UnregisteredSessionRecord;
	persist: () => Promise<void>;
}> => {
	const session: SessionRecord<UserType> = {};
	const unregisteredSession: UnregisteredSessionRecord = {};

	if (!authSessionStore) {
		return {
			session,
			unregisteredSession,
			persist: async () => {}
		};
	}

	const initialSessionIds = new Set<UserSessionId>();
	const initialUnregisteredIds = new Set<UserSessionId>();

	if (userSessionId) {
		const currentSession = await authSessionStore.getSession(userSessionId);
		if (currentSession) {
			session[userSessionId] = currentSession;
			initialSessionIds.add(userSessionId);
		}

		const currentUnregistered =
			await authSessionStore.getUnregisteredSession(userSessionId);
		if (currentUnregistered) {
			unregisteredSession[userSessionId] = currentUnregistered;
			initialUnregisteredIds.add(userSessionId);
		}
	}

	return {
		session,
		unregisteredSession,
		persist: async () => {
			const nextSessionIds = new Set<UserSessionId>();
			for (const [key, value] of collectSessionEntries(session)) {
				nextSessionIds.add(key);
				await authSessionStore.setSession(key, value);
			}

			for (const initialId of initialSessionIds) {
				if (!nextSessionIds.has(initialId)) {
					await authSessionStore.removeSession(initialId);
				}
			}

			const nextUnregisteredIds = new Set<UserSessionId>();
			for (const [key, value] of collectUnregisteredEntries(
				unregisteredSession
			)) {
				nextUnregisteredIds.add(key);
				await authSessionStore.setUnregisteredSession(key, value);
			}

			for (const initialId of initialUnregisteredIds) {
				if (!nextUnregisteredIds.has(initialId)) {
					await authSessionStore.removeUnregisteredSession(initialId);
				}
			}
		}
	};
};
