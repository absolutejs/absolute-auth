import type { AuditEvent, AuditEventType } from '../audit/types';

export type WebhookEndpoint = {
	secret: string;
	url: string;
};

// The delivered, signed envelope. `type` mirrors `data.type` for convenient routing on receipt.
// The taxonomy is the audit event taxonomy, so every auth event is deliverable as a webhook.
export type WebhookEvent = {
	createdAt: number;
	data: AuditEvent;
	id: string;
	type: AuditEventType;
};
