import { Elysia } from 'elysia';
import { agentAuthContextPlugin } from './agents/context';
import type { AgentAuthConfig } from './agents/config';
import type { AuditEmitter } from './audit/config';
import type { AuthorizationConfig } from './authorization/config';
import { protectPermissionPlugin } from './authorization/protectPermission';
import { pluginDependencySeed } from './pluginIdentity';
import { protectRoutePlugin } from './routes/protectRoute';
import { stepUpPlugin } from './routes/stepUp';
import type { AuthSessionStore } from './session/types';

export const createAuthContext = <UserType>({
	agentAuth,
	authSessionStore,
	authorization,
	emit,
	seedSource
}: {
	agentAuth?: AgentAuthConfig;
	authSessionStore?: AuthSessionStore<UserType>;
	authorization?: AuthorizationConfig<UserType>;
	emit?: AuditEmitter;
	seedSource?: object;
}) =>
	new Elysia({
		name: '@absolutejs/auth/context',
		seed: pluginDependencySeed(seedSource)
	}).use([
		protectRoutePlugin<UserType>({ authSessionStore }),
		stepUpPlugin<UserType>({ authSessionStore }),
		authorization
			? protectPermissionPlugin<UserType>({
					...authorization,
					authSessionStore,
					emit
				})
			: new Elysia(),
		agentAuthContextPlugin(agentAuth)
	]);

export type AuthInstance<UserType> = ReturnType<
	typeof createAuthContext<UserType>
>;
