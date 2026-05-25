import type { AuditEmitter } from '../audit/config';
import type { AuthSessionStore } from '../session/types';
import type { RouteString } from '../types';

// GDPR/CCPA self-service compliance, delegated to consumer hooks. `auth()` mounts the export
// (right to access) and delete (right to erasure) routes only when this block is present. The
// package owns the route wiring, session teardown, and audit; the consumer owns what data is
// gathered and how the user record is erased/anonymized in its own stores.
export type ComplianceConfig<UserType> = {
	complianceRoute?: RouteString;
	// Right to erasure (GDPR Art. 17): erase / anonymize the user in the consumer's stores. The
	// route then revokes all of the user's sessions and clears the caller's cookie.
	deleteUserData: (context: {
		user: UserType;
		userId?: string;
	}) => void | Promise<void>;
	// Right to access (GDPR Art. 15): return everything the system holds on the user, serialized
	// to JSON for download.
	exportUserData: (context: {
		user: UserType;
	}) => Record<string, unknown> | Promise<Record<string, unknown>>;
	// Stable per-user key, used to find and revoke all of the user's sessions on deletion. Without
	// it, only the caller's current session is cleared (sibling sessions can't be enumerated).
	getUserId?: (user: UserType) => string;
};

export type CompliancePluginProps<UserType> = ComplianceConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
	emit?: AuditEmitter;
};
