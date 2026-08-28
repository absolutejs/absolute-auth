import { Elysia, StatusMap, t, type ElysiaStatus } from 'elysia';
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

type PermissionFailureResponse =
	| ElysiaStatus<
			'Bad Request',
			'Cookies are missing',
			(typeof StatusMap)['Bad Request']
	  >
	| ElysiaStatus<
			'Forbidden',
			'Insufficient permissions',
			(typeof StatusMap)['Forbidden']
	  >
	| ElysiaStatus<
			'Unauthorized',
			'User is not authenticated',
			(typeof StatusMap)['Unauthorized']
	  >;

type ProtectPermission<UserType> = {
	<AuthReturn, AuthFailReturn = never>(
		check: PermissionCheck,
		handleAuth: (user: UserType) => Promise<AuthReturn>,
		handleAuthFail?: (error: PermissionFailError) => AuthFailReturn
	): Promise<
		PermissionFailureResponse | AuthReturn | Awaited<AuthFailReturn>
	>;
	<AuthReturn, AuthFailReturn = never>(
		check: PermissionCheck,
		handleAuth: (user: UserType) => AuthReturn,
		handleAuthFail?: (error: PermissionFailError) => AuthFailReturn
	): Promise<
		PermissionFailureResponse | AuthReturn | Awaited<AuthFailReturn>
	>;
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
		.guard({
			cookie: t.Cookie({ user_session_id: userSessionIdTypebox }),
			schema: 'merge'
		})
		.derive(
			({ store: { session }, cookie: { user_session_id }, status }) => {
				const protectPermission: ProtectPermission<UserType> = (
					check,
					handleAuth,
					handleAuthFail
				) =>
					getStatusFromSource<UserType>({
						authSessionStore,
						session,
						user_session_id
					}).then(async ({ user, error }) => {
						if (error) {
							return (
								(await handleAuthFail?.(error)) ??
								status(error.code, error.message)
							);
						}
						if (!user) {
							return (
								(await handleAuthFail?.({
									code: 'Unauthorized',
									message: 'User is not authenticated'
								})) ??
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
								(await handleAuthFail?.({
									code: 'Forbidden',
									message: 'Insufficient permissions'
								})) ??
								status('Forbidden', 'Insufficient permissions')
							);
						}

						return handleAuth(user);
					});

				return { protectPermission };
			}
		)
		.as('global');
