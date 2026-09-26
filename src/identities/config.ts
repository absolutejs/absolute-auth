import type { AuditEmitter } from '../audit/config';
import type { AuthSessionStore } from '../session/types';
import type { RouteString } from '../types';
import type { AuthIdentity, AuthIdentityStore } from './types';

// Sign-in identities. When present, `auth()` mounts `GET {identitiesRoute}` (the caller's
// linked sign-in methods) and `DELETE {identitiesRoute}/:id` (unlink one). Linking happens
// in the OAuth callback: start `/oauth2/:provider/authorization?intent=link_identity`
// while signed in and call `linkCallbackIdentity` from `onLinkIdentity`.
export type IdentitiesConfig<UserType> = {
	identityStore: AuthIdentityStore;
	// Stable per-user key (e.g. the user's `sub`).
	getUserId: (user: UserType) => string;
	// Whether the user can still sign in some other way (a passkey or password) once
	// `identity` is gone. Without it, the last linked identity can't be removed.
	hasOtherSignInMethod?: (context: {
		identity: AuthIdentity;
		user: UserType;
	}) => boolean | Promise<boolean>;
	identitiesRoute?: RouteString;
	onIdentityUnlinked?: (context: {
		identity: AuthIdentity;
		user: UserType;
	}) => void | Promise<void>;
};

export type IdentityRouteProps<UserType> = IdentitiesConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
	emit?: AuditEmitter;
};

export const DEFAULT_IDENTITIES_ROUTE: RouteString = '/auth/identities';
