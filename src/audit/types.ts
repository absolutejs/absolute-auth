import type { OrganizationId } from '../tenancy';

export type AuditEventType =
	| 'account_deleted'
	| 'authorization_denied'
	| 'credentials_login'
	| 'credentials_login_failed'
	| 'data_exported'
	| 'email_verified'
	| 'identity_conflict'
	| 'logout'
	| 'mfa_challenge'
	| 'mfa_challenge_failed'
	| 'mfa_enrolled'
	| 'oauth_login'
	| 'password_reset'
	| 'register'
	| 'scim_provision'
	| 'session_revoked'
	| 'sso_login'
	| 'token_refreshed'
	| 'token_revoked';

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
