import type { OrganizationId } from '../tenancy';

export type AuditEventType =
	| 'account_deleted'
	| 'authorization_denied'
	| 'credentials_login'
	| 'credentials_login_failed'
	| 'data_exported'
	| 'email_verified'
	| 'identity_conflict'
	| 'invitation_accepted'
	| 'invitation_created'
	| 'logout'
	| 'membership_removed'
	| 'mfa_challenge'
	| 'mfa_challenge_failed'
	| 'mfa_enrolled'
	| 'oauth_login'
	| 'organization_created'
	| 'password_reset'
	| 'passwordless_login'
	| 'register'
	| 'role_assigned'
	| 'scim_provision'
	| 'scim_token_created'
	| 'session_revoked'
	| 'setup_session_created'
	| 'sso_connection_configured'
	| 'sso_login'
	| 'token_refreshed'
	| 'token_revoked'
	| 'webauthn_authenticated'
	| 'webauthn_registered';

export type AuditEvent = {
	at: number;
	ip?: string;
	metadata?: Record<string, unknown>;
	organizationId?: OrganizationId;
	type: AuditEventType;
	userId?: string;
};

export type AuditEventFilter = {
	limit?: number;
	userId?: string;
};

// Append-only sink for auth events. `list` is optional (in-memory + Neon provide it);
// an exporter / SIEM forwarder only needs `append`.
export type AuditSink = {
	append: (event: AuditEvent) => Promise<void>;
	list?: (filter?: AuditEventFilter) => Promise<AuditEvent[]>;
};
