import type { SessionData } from '../types';

export const hasRecentAuthentication = <UserType>(
	session: SessionData<UserType>,
	maxAgeMs: number,
	now = Date.now()
) =>
	session.authenticatedAt !== undefined &&
	now >= session.authenticatedAt &&
	now - session.authenticatedAt <= maxAgeMs;
