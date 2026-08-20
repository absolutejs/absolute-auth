import { Elysia, t } from 'elysia';
import { getStatusFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import type { AuthSessionSource } from '../session/types';
import { userSessionIdTypebox } from '../typebox';
import { pluginDependencySeed } from '../pluginIdentity';

// Fail-closed counterpart to protectRoutePlugin. Mounting this GUARDS every
// route in its scope by default: an unauthenticated (or expired/invalid)
// request is rejected with 401 in `onBeforeHandle`, before the handler runs,
// and handlers read the authenticated user from `ctx.user`. Because protection
// is applied by MOUNTING the plugin — not by remembering to wrap each handler —
// forgetting a per-route check cannot silently leave a route public. That is
// the opposite failure mode of protectRoutePlugin, which is opt-in per handler
// (forget the wrapper and the route is open).
//
// `ctx.user` is typed `UserType | null` but is guaranteed non-null inside any
// handler this plugin guards, since `onBeforeHandle` has already rejected the
// null case.
export const requireAuthPlugin = <UserType>({
	authSessionStore
}: {
	authSessionStore?: AuthSessionSource<UserType>;
} = {}) =>
	new Elysia({
		name: '@absolutejs/auth/require-auth',
		seed: pluginDependencySeed(authSessionStore)
	})
		.use(sessionStore<UserType>())
		.guard({
			cookie: t.Cookie({ user_session_id: userSessionIdTypebox }),
			schema: 'merge'
		})
		.derive(async ({ store: { session }, cookie: { user_session_id } }) => {
			const { user } = await getStatusFromSource<UserType>({
				authSessionStore,
				session,
				user_session_id
			});

			return { user: user ?? null };
		})
		.beforeHandle(({ user, status }) =>
			// Returning undefined lets the request continue to the handler;
			// returning the 401 short-circuits it (fail closed).
			user === null
				? status('Unauthorized', 'User is not authenticated')
				: undefined
		)
		.as('global');
