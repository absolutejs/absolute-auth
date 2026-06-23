import type { Cookie } from 'elysia';
import { isUserSessionId } from '../typeGuards';
import type {
	SessionData,
	SessionRecord,
	UnregisteredSessionData,
	UnregisteredSessionRecord,
	UserSessionId
} from '../types';
import type { AuthSessionStore } from './types';

const collectSessionEntries = <UserType>(session: SessionRecord<UserType>) =>
	Object.entries(session).filter(
		(entry): entry is [UserSessionId, SessionData<UserType>] =>
			isUserSessionId(entry[0])
	);

const collectUnregisteredEntries = (
	unregisteredSession: UnregisteredSessionRecord
) =>
	Object.entries(unregisteredSession).filter(
		(entry): entry is [UserSessionId, UnregisteredSessionData] =>
			isUserSessionId(entry[0])
	);

const removeStaleIds = (
	initialIds: Set<UserSessionId>,
	nextIds: Set<UserSessionId>,
	remove: (id: UserSessionId) => Promise<void> | void
) =>
	Promise.all(
		[...initialIds]
			.filter((initialId) => !nextIds.has(initialId))
			.map((initialId) => remove(initialId))
	);

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
			persist: async () => undefined
		};
	}

	const initialSessionIds = new Set<UserSessionId>();
	const initialUnregisteredIds = new Set<UserSessionId>();

	const currentSession = userSessionId
		? await authSessionStore.getSession(userSessionId)
		: undefined;
	if (userSessionId && currentSession) {
		session[userSessionId] = currentSession;
		initialSessionIds.add(userSessionId);
	}

	const currentUnregistered = userSessionId
		? await authSessionStore.getUnregisteredSession(userSessionId)
		: undefined;
	if (userSessionId && currentUnregistered) {
		unregisteredSession[userSessionId] = currentUnregistered;
		initialUnregisteredIds.add(userSessionId);
	}

	const persist = async () => {
		const sessionEntries = collectSessionEntries(session);
		const nextSessionIds = new Set(sessionEntries.map(([key]) => key));
		await Promise.all(
			sessionEntries.map(([key, value]) =>
				authSessionStore.setSession(key, value)
			)
		);
		await removeStaleIds(initialSessionIds, nextSessionIds, (initialId) =>
			authSessionStore.removeSession(initialId)
		);

		const unregisteredEntries =
			collectUnregisteredEntries(unregisteredSession);
		const nextUnregisteredIds = new Set(
			unregisteredEntries.map(([key]) => key)
		);
		await Promise.all(
			unregisteredEntries.map(([key, value]) =>
				authSessionStore.setUnregisteredSession(key, value)
			)
		);
		await removeStaleIds(
			initialUnregisteredIds,
			nextUnregisteredIds,
			(initialId) => authSessionStore.removeUnregisteredSession(initialId)
		);
	};

	return {
		persist,
		session,
		unregisteredSession
	};
};
const removeSessionFromSource = async <UserType>({
	authSessionStore,
	session,
	userSessionId
}: {
	authSessionStore?: AuthSessionStore<UserType>;
	session?: SessionRecord<UserType>;
	userSessionId: UserSessionId;
}) => {
	if (authSessionStore) {
		await authSessionStore.removeSession(userSessionId);

		return;
	}

	if (session) {
		delete session[userSessionId];
	}
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
		// Surfaced so callers (userStatus, protectRoute) can show an "impersonating" banner
		// and gate sensitive actions — without it the impersonation is invisible to the app.
		impersonator: userSession?.impersonator,
		user: userSession?.user ?? null
	};
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
}) => {
	if (!userSessionId) return undefined;

	const userSession = authSessionStore
		? await authSessionStore.getSession(userSessionId)
		: session?.[userSessionId];
	if (!userSession) return undefined;

	if (removeExpired && userSession.expiresAt < Date.now()) {
		await removeSessionFromSource({
			authSessionStore,
			session,
			userSessionId
		});

		return undefined;
	}

	return userSession;
};
