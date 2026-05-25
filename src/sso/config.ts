import type { OAuth2TokenResponse, OIDCIdTokenClaims } from 'citra';
import { MILLISECONDS_IN_A_DAY } from '../constants';
import type { OrganizationId } from '../tenancy';
import type { RouteString, UserSessionId } from '../types';
import type { SSOConnection, SSOConnectionStore } from './types';

export const DEFAULT_SSO_ROUTE = '/sso';
export const DEFAULT_SSO_SESSION_TTL_MS = MILLISECONDS_IN_A_DAY;

// The verified, normalized result of an SSO sign-in handed to the consumer's `getSsoUser`
// hook — the consumer owns the user table and maps this identity to its own user (creating
// one on first sign-in). `claims` are the already-signature-verified id_token claims.
export type SsoIdentity = {
	claims: OIDCIdTokenClaims;
	connection: SSOConnection;
	email?: string;
	organizationId: OrganizationId;
	sub: string;
	tokenResponse: OAuth2TokenResponse;
};

// Per-organization SSO (the WorkOS-style model). Additive and optional, mirroring the OAuth
// and credentials config surfaces. `getSsoUser` resolves the identity to a user (throw to
// reject); the route then mints the same `SessionData<UserType>` as every other flow.
export type SSOConfig<UserType> = {
	getSsoUser: (identity: SsoIdentity) => Promise<UserType> | UserType;
	onSsoCallbackError?: (context: {
		error: unknown;
		organizationId: string;
	}) => void | Promise<void>;
	onSsoCallbackSuccess?: (context: {
		identity: SsoIdentity;
		user: UserType;
		userSessionId: UserSessionId;
	}) => void | Promise<void>;
	sessionDurationMs?: number;
	ssoConnectionStore: SSOConnectionStore;
	ssoRoute?: RouteString;
};
