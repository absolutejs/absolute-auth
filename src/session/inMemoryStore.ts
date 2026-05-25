import { isUserSessionId } from '../typeGuards';
import type {
	SessionData,
	UnregisteredSessionData,
	UserSessionId
} from '../types';
import type { AuthSessionStore } from './types';

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
	sessionInformation: value.sessionInformation
		? { ...value.sessionInformation }
		: undefined,
	userIdentity: value.userIdentity ? { ...value.userIdentity } : undefined
});

export const createInMemoryAuthSessionStore = <UserType>(
	input: CreateInMemoryAuthSessionStoreOptions<UserType> = {}
): AuthSessionStore<UserType> => {
	const sessions = new Map<UserSessionId, SessionData<UserType>>(
		Object.entries(input.sessions ?? {})
			.filter((entry): entry is [UserSessionId, SessionData<UserType>] =>
				isUserSessionId(entry[0])
			)
			.map(([id, value]) => [id, cloneSessionData(value)])
	);
	const unregisteredSessions = new Map<
		UserSessionId,
		UnregisteredSessionData
	>(
		Object.entries(input.unregisteredSessions ?? {})
			.filter(
				(entry): entry is [UserSessionId, UnregisteredSessionData] =>
					isUserSessionId(entry[0])
			)
			.map(([id, value]) => [id, cloneUnregisteredSessionData(value)])
	);

	return {
		getSession: async (id) => {
			const session = sessions.get(id);

			return session ? cloneSessionData(session) : undefined;
		},
		getUnregisteredSession: async (id) => {
			const session = unregisteredSessions.get(id);

			return session ? cloneUnregisteredSessionData(session) : undefined;
		},
		listSessionIds: async () => [...sessions.keys()],
		listUnregisteredSessionIds: async () => [
			...unregisteredSessions.keys()
		],
		removeSession: async (id) => {
			sessions.delete(id);
		},
		removeUnregisteredSession: async (id) => {
			unregisteredSessions.delete(id);
		},
		setSession: async (id, value) => {
			sessions.set(id, cloneSessionData(value));
		},
		setUnregisteredSession: async (id, value) => {
			unregisteredSessions.set(id, cloneUnregisteredSessionData(value));
		}
	};
};
