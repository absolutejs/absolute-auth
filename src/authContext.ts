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
import type { AccessTokenPrincipalConfig } from './principal';
import { createAbsoluteAuthSyncBridge } from './syncBridge';

export const createAuthContext = <UserType>({
	agentAuth,
	accessTokens,
	authSessionStore,
	authorization,
	emit,
	seedSource
}: {
	agentAuth?: AgentAuthConfig;
	accessTokens?: AccessTokenPrincipalConfig<UserType>;
	authSessionStore?: AuthSessionStore<UserType>;
	authorization?: AuthorizationConfig<UserType>;
	emit?: AuditEmitter;
	seedSource?: object;
}) => {
	const absoluteAuthSync = accessTokens
		? createAbsoluteAuthSyncBridge(accessTokens)
		: undefined;
	const syncBridge = new Elysia({
		name: '@absolutejs/auth/sync-bridge',
		seed: pluginDependencySeed(seedSource)
	})
		.decorate('absoluteAuthSync', absoluteAuthSync)
		.as('global');

	return new Elysia({
		name: '@absolutejs/auth/context',
		seed: pluginDependencySeed(seedSource)
	}).use([
		syncBridge,
		protectRoutePlugin<UserType>({ accessTokens, authSessionStore }),
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
};

export type AuthInstance<UserType> = ReturnType<
	typeof createAuthContext<UserType>
>;
