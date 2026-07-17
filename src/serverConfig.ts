import type { AuthConfig as CompleteAuthConfig } from './types';

type CoreAuthConfigKey =
	| 'audit'
	| 'authSessionStore'
	| 'getUser'
	| 'onCallbackSuccess'
	| 'onSessionCleanup'
	| 'providersConfiguration'
	| 'sessionDurationMs'
	| 'sessions';

/**
 * Declaration-stable subset for the common server integration. Optional Auth
 * features remain accepted through the open property surface; applications
 * that need contextual typing for those features can import `AuthConfig` from
 * the package root.
 */
export type ServerAuthConfig<UserType> = Pick<
	CompleteAuthConfig<UserType>,
	CoreAuthConfigKey
> &
	Record<string, unknown>;
