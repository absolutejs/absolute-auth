import type { SessionData, UserSessionId } from '../types';
import type { AuthSessionStore } from './types';

export type UserSession<UserType> = {
	id: UserSessionId;
	session: SessionData<UserType>;
};

type ListUserSessionsProps<UserType> = {
	authSessionStore: AuthSessionStore<UserType>;
	getUserId: (user: UserType) => string;
	userId: string;
};

// Finds every active session belonging to a user by scanning `listSessionIds` and
// matching `getUserId`. O(n) over sessions — fine for list/revoke; a user→sessions index
// can replace it later if needed.
export const listUserSessions = async <UserType>({
	authSessionStore,
	getUserId,
	userId
}: ListUserSessionsProps<UserType>) => {
	const ids = (await authSessionStore.listSessionIds?.()) ?? [];
	const records = await Promise.all(
		ids.map((id) => authSessionStore.getSession(id))
	);

	return ids
		.map((id, index) => ({ id, session: records[index] }))
		.filter(
			(entry): entry is UserSession<UserType> =>
				entry.session !== undefined &&
				getUserId(entry.session.user) === userId
		);
};

export const revokeUserSessions = async <UserType>({
	authSessionStore,
	exceptSessionId,
	getUserId,
	userId
}: ListUserSessionsProps<UserType> & {
	exceptSessionId?: UserSessionId;
}) => {
	const sessions = await listUserSessions({
		authSessionStore,
		getUserId,
		userId
	});
	const targets = sessions.filter((entry) => entry.id !== exceptSessionId);
	await Promise.all(
		targets.map((entry) => authSessionStore.removeSession(entry.id))
	);

	return targets.length;
};
