import type { RouteString } from '../types';
import type { AuthSessionStore } from './types';

export type SessionsConfig<UserType> = {
	// Stable per-user key used to group a user's sessions (e.g. the user's `sub`).
	getUserId: (user: UserType) => string;
	sessionsRoute?: RouteString;
};

export type SessionsRouteProps<UserType> = SessionsConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
};
