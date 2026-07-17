import { auth as createAuth } from './index';
import type { AuthInstance } from './authInstance';
import type { ServerAuthConfig } from './serverConfig';

/**
 * Create the complete AbsoluteJS auth application through a declaration-stable
 * server entry point. Import this subpath in server applications so TypeScript
 * does not need to load declarations for every optional Auth feature.
 */
export const auth: <UserType>(
	config: ServerAuthConfig<UserType>
) => Promise<AuthInstance<UserType>> = createAuth;

export type { AuthInstance } from './authInstance';
export type { AuditSink } from './audit/types';
export { protectRoutePlugin } from './routes/protectRoute';
export type { AuthSessionStore } from './session/types';
export { isUserSessionId } from './typeGuards';
export { userSessionIdTypebox } from './typebox';
export type {
	OAuth2ConfigurationOptions,
	SessionData,
	UnregisteredSessionData,
	UserSessionId
} from './types';
export type { ServerAuthConfig as AuthConfig } from './serverConfig';
export { instantiateUserSession } from './utils';
export type { OAuth2TokenResponse, ProviderOption } from 'citra';
export {
	extractPropFromIdentity,
	isValidProviderOption,
	providers
} from 'citra';
