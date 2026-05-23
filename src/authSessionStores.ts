import type { AbsoluteAuthSessionStore } from './sessionTypes';
import type {
	SessionData,
	UnregisteredSessionData,
	UserSessionId
} from './types';

export type CreateInMemoryAuthSessionStoreOptions<UserType> = {
	sessions?: Record<UserSessionId, SessionData<UserType>>;
	unregisteredSessions?: Record<UserSessionId, UnregisteredSessionData>;
};

const cloneSessionData = <UserType>(
	value: SessionData<UserType>
): SessionData<UserType> => ({
	...value
});

const cloneUnregisteredSessionData = (
	value: UnregisteredSessionData
): UnregisteredSessionData => ({
	...value,
	userIdentity: value.userIdentity ? { ...value.userIdentity } : undefined,
	sessionInformation: value.sessionInformation
		? { ...value.sessionInformation }
		: undefined
});

export const createInMemoryAuthSessionStore = <UserType>(
	input: CreateInMemoryAuthSessionStoreOptions<UserType> = {}
): AbsoluteAuthSessionStore<UserType> => {
	const sessions = new Map<UserSessionId, SessionData<UserType>>(
		Object.entries(input.sessions ?? {}).map(([id, value]) => [
			id as UserSessionId,
			cloneSessionData(value)
		])
	);
	const unregisteredSessions = new Map<
		UserSessionId,
		UnregisteredSessionData
	>(
		Object.entries(input.unregisteredSessions ?? {}).map(([id, value]) => [
			id as UserSessionId,
			cloneUnregisteredSessionData(value)
		])
	);

	return {
		getSession: async (id) => {
			const session = sessions.get(id);
			return session ? cloneSessionData(session) : undefined;
		},
		setSession: async (id, value) => {
			sessions.set(id, cloneSessionData(value));
		},
		removeSession: async (id) => {
			sessions.delete(id);
		},
		getUnregisteredSession: async (id) => {
			const session = unregisteredSessions.get(id);
			return session ? cloneUnregisteredSessionData(session) : undefined;
		},
		setUnregisteredSession: async (id, value) => {
			unregisteredSessions.set(id, cloneUnregisteredSessionData(value));
		},
		removeUnregisteredSession: async (id) => {
			unregisteredSessions.delete(id);
		},
		listSessionIds: async () => [...sessions.keys()],
		listUnregisteredSessionIds: async () => [...unregisteredSessions.keys()]
	};
};
