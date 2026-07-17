import { Elysia, t } from 'elysia';
import { getStatusFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import { pluginDependencySeed } from '../pluginIdentity';
import type { AuthorizationPluginProps, PermissionCheck } from './config';

type PermissionFailError =
	| {
			readonly code: 'Bad Request';
			readonly message: 'Cookies are missing';
	  }
	| {
			readonly code: 'Forbidden';
			readonly message: 'Insufficient permissions';
	  }
	| {
			readonly code: 'Unauthorized';
			readonly message: 'User is not authenticated';
	  };

// RBAC/ABAC guard, usable alongside `protectRoute`. `protectPermission(check, handler)` runs the
// handler only when the caller is authenticated AND the consumer's `hasPermission` hook approves
// the `{ permission, organizationId }` descriptor — otherwise 401 (not authenticated) or 403
// (denied). The decision is fully delegated, so the package never models roles or permissions.
export const protectPermissionPlugin = <UserType>({
	authSessionStore,
	emit,
	hasPermission
}: AuthorizationPluginProps<UserType>) =>
	new Elysia({
		name: '@absolutejs/auth/permission',
		seed: pluginDependencySeed(hasPermission)
	})
		.use(sessionStore<UserType>())
		.guard({ cookie: t.Cookie({ user_session_id: userSessionIdTypebox }) })
		.derive(
			({ store: { session }, cookie: { user_session_id }, status }) => ({
				protectPermission: <AuthReturn, AuthFailReturn>(
					check: PermissionCheck,
					handleAuth: (
						user: UserType
					) => AuthReturn | Promise<AuthReturn>,
					handleAuthFail?: (
						error: PermissionFailError
					) => AuthFailReturn
				) =>
					getStatusFromSource<UserType>({
						authSessionStore,
						session,
						user_session_id
					}).then(async ({ user, error }) => {
						if (error) {
							return (
								handleAuthFail?.(error) ??
								status(error.code, error.message)
							);
						}
						if (!user) {
							return (
								handleAuthFail?.({
									code: 'Unauthorized',
									message: 'User is not authenticated'
								}) ??
								status(
									'Unauthorized',
									'User is not authenticated'
								)
							);
						}

						const granted = await hasPermission({
							organizationId: check.organizationId,
							permission: check.permission,
							user
						});
						if (!granted) {
							await emit?.({
								at: Date.now(),
								metadata: { permission: check.permission },
								organizationId: check.organizationId,
								type: 'authorization_denied'
							});

							return (
								handleAuthFail?.({
									code: 'Forbidden',
									message: 'Insufficient permissions'
								}) ??
								status('Forbidden', 'Insufficient permissions')
							);
						}

						return handleAuth(user);
					})
			})
		)
		.as('global');
