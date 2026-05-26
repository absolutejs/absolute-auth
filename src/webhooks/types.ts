import type { AuditEvent, AuditEventType } from '../audit/types';

export type WebhookEndpoint = {
	// Optional per-endpoint filter — when present, only events of these types reach this endpoint.
	// Useful when one webhook only wants logins, another only wants admin actions, etc. Absent =
	// every emitted event is delivered (the original behavior).
	events?: readonly AuditEventType[];
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

// A delivery the dispatcher gave up on after exhausting its retries. Persisted to the optional
// `WebhookDeliveryStore` so consumers can inspect (alerting), replay (manual or scheduled), and
// then `removeFailure(id)` once handled. The signed envelope is preserved so replay is
// byte-stable — the receiver sees the same `webhook-id` and the same `webhook-signature` as the
// original attempt would have produced for the original timestamp.
export type WebhookDelivery = {
	attempts: number;
	createdAt: number;
	endpointUrl: string;
	envelope: WebhookEvent;
	lastError?: string;
	lastStatus?: number;
};

export type WebhookDeliveryStore = {
	listFailed: (limit?: number) => Promise<WebhookDelivery[]>;
	recordFailure: (delivery: WebhookDelivery) => Promise<void>;
	removeFailure: (envelopeId: string) => Promise<void>;
};
