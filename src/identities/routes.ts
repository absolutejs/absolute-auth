import { Elysia, t } from 'elysia';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import { DEFAULT_IDENTITIES_ROUTE, type IdentityRouteProps } from './config';
import type { AuthIdentity } from './types';

const readString = (identity: AuthIdentity, key: string) => {
	const value = identity.metadata[key];

	return typeof value === 'string' ? value : undefined;
};

const summarize = (identity: AuthIdentity) => ({
	createdAt: identity.createdAt,
	email: readString(identity, 'email'),
	id: identity.id,
	lastUsedAt: identity.lastUsedAt,
	name: readString(identity, 'name'),
	provider: identity.provider
});

export type IdentitySummary = ReturnType<typeof summarize>;

// `GET` lists the caller's sign-in identities; `DELETE /:id` unlinks one the caller owns,
// refusing to remove the last way they can sign in.
export const identityRoutes = <UserType>({
	authSessionStore,
	emit,
	getUserId,
	hasOtherSignInMethod,
	identitiesRoute = DEFAULT_IDENTITIES_ROUTE,
	identityStore,
	onIdentityUnlinked
}: IdentityRouteProps<UserType>) => {
	const cookie = t.Cookie({
		user_session_id: t.Optional(userSessionIdTypebox)
	});

	return new Elysia()
		.use(sessionStore<UserType>())
		.get(
			identitiesRoute,
			{ cookie },
			async ({
				cookie: { user_session_id },
				status,
				store: { session }
			}) => {
				const current = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});
				if (!current)
					return status('Unauthorized', 'Authentication required');
				const identities = await identityStore.listIdentitiesByUser(
					getUserId(current.user)
				);

				return status('OK', { identities: identities.map(summarize) });
			}
		)
		.delete(
			`${identitiesRoute}/:id`,
			{ cookie, params: t.Object({ id: t.String({ maxLength: 512 }) }) },
			async ({
				cookie: { user_session_id },
				params: { id },
				status,
				store: { session }
			}) => {
				const current = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});
				if (!current)
					return status('Unauthorized', 'Authentication required');
				const userId = getUserId(current.user);
				const identity = await identityStore.getIdentity(id);
				// Someone else's identity looks the same as a missing one.
				if (!identity || identity.userId !== userId)
					return status('Not Found', 'Sign-in method not found');
				const remaining = (
					await identityStore.listIdentitiesByUser(userId)
				).filter((other) => other.id !== identity.id);
				if (
					remaining.length === 0 &&
					!(await hasOtherSignInMethod?.({
						identity,
						user: current.user
					}))
				)
					return status(
						'Conflict',
						'Keep at least one way to sign in'
					);
				await identityStore.removeIdentity(identity.id);
				await emit?.({
					at: Date.now(),
					metadata: { provider: identity.provider },
					type: 'identity_unlinked',
					userId
				});
				await onIdentityUnlinked?.({ identity, user: current.user });

				return status('OK', { removed: identity.id });
			}
		);
};
