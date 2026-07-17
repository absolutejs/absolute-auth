import type { AuthInstance } from './authContext';
import { auth as createAuth } from './index';
import type { AuthConfig } from './types';

/**
 * Create the complete AbsoluteJS auth application through a declaration-stable
 * server entry point. Import this subpath in server applications so TypeScript
 * does not need to load declarations for every optional Auth feature.
 */
export const auth: <UserType>(
	configuration: AuthConfig<UserType>
) => Promise<AuthInstance<UserType>> = createAuth;

export { createAuthContext } from './authContext';
export type { AuthInstance } from './authContext';
export type { AuditSink } from './audit/types';
export { protectRoutePlugin } from './routes/protectRoute';
export type { AuthSessionStore } from './session/types';
export { isUserSessionId } from './typeGuards';
export { userSessionIdTypebox } from './typebox';
export type {
	AuthConfig,
	OAuth2ConfigurationOptions,
	SessionData,
	UnregisteredSessionData,
	UserSessionId
} from './types';
export { instantiateUserSession } from './utils';
export type { OAuth2TokenResponse, ProviderOption } from 'citra';
export {
	extractPropFromIdentity,
	isValidProviderOption,
	providers
} from 'citra';
