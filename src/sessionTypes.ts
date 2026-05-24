import type {
	SessionData,
	UnregisteredSessionData,
	UserSessionId
} from './types';

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
};
