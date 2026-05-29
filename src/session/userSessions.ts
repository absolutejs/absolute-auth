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

// The `user` handed to `protectRoute`/`userStatus` is the snapshot persisted in the
// session at login (`auth_sessions.user_json`); it is NOT re-read from your own user
// table per request. So a post-login mutation — a role grant, a ban, a tier change —
// stays invisible to existing sessions until the snapshot is rewritten, producing
// silent 403s on role-gated routes. Call this from your own mutators (assignRole, ban,
// etc.) right after the DB write to push the fresh `user` into every active session for
// that user. Returns the number of sessions updated. (The library is agnostic to your
// user model, so it cannot re-fetch on its own — you supply the new `user`.)
export const refreshUserSessions = async <UserType>({
	authSessionStore,
	getUserId,
	user,
	userId
}: ListUserSessionsProps<UserType> & {
	user: UserType;
}) => {
	const sessions = await listUserSessions({
		authSessionStore,
		getUserId,
		userId
	});
	await Promise.all(
		sessions.map((entry) =>
			authSessionStore.setSession(entry.id, {
				...entry.session,
				user
			})
		)
	);

	return sessions.length;
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
