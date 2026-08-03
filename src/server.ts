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
export type { PortalConfig } from './portal/config';
export type {
	SetupCapability,
	SetupSession,
	SetupSessionStore
} from './portal/types';
export { createSetupSession } from './portal/operations';
export { createPostgresSetupSessionStore } from './portal/postgresSetupSessionStore';
export { protectRoutePlugin } from './routes/protectRoute';
export { readSessionCookie } from './session/cookieReader';
export { requireAuthPlugin } from './routes/requireAuth';
export type { ScimConfig } from './scim/config';
export type {
	ScimFilter,
	ScimGroup,
	ScimGroupInput,
	ScimTokenStore,
	ScimUser,
	ScimUserInput
} from './scim/types';
export { createPostgresScimTokenStore } from './scim/postgresScimTokenStore';
export type { AuthSessionStore } from './session/types';
export {
	VerificationProviderError,
	type VerificationCheckInput,
	type VerificationCheckResult,
	type VerificationCheckStatus,
	type VerificationProvider,
	type VerificationProviderErrorKind,
	type VerificationPurpose,
	type VerificationStartInput,
	type VerificationStartResult
} from './verification/types';
export type { NodeSamlAdapterOptions } from './sso/nodeSamlAdapter';
export { createNodeSamlAdapter } from './sso/nodeSamlAdapter';
export type { SsoIdentity, SSOConfig } from './sso/config';
export type { SSOConnection, SSOConnectionStore } from './sso/types';
export { createPostgresSsoConnectionStore } from './sso/postgresSsoConnectionStore';
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
