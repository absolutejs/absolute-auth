import { MILLISECONDS_IN_A_SECOND } from '../constants';
import type { WebhookEndpoint, WebhookEvent } from './types';

const DEFAULT_TIMEOUT_SECONDS = 5;

export const DEFAULT_WEBHOOK_TIMEOUT_MS =
	MILLISECONDS_IN_A_SECOND * DEFAULT_TIMEOUT_SECONDS;

// The minimal slice of `fetch` the dispatcher uses. The global `fetch` is assignable to it, and a
// test/proxy override needs no cast (and no `preconnect`).
export type WebhookFetch = (
	url: string,
	init: {
		body: string;
		headers: Record<string, string>;
		method: string;
		signal: AbortSignal;
	}
) => Promise<{ ok: boolean; status: number }>;

// Signed outbound webhooks. When present, `auth()` forwards every emitted event (the audit
// taxonomy) to each endpoint, HMAC-signed with the per-endpoint secret using the Standard
// Webhooks scheme. Delivery is best-effort and isolated per endpoint — a failing endpoint never
// breaks the auth flow (it surfaces through `onDeliveryError`). PII redaction (`audit.redact`)
// applies before delivery.
export type WebhooksConfig = {
	endpoints: WebhookEndpoint[];
	// Override the HTTP client (testing, proxy, custom retries). Defaults to global fetch.
	fetch?: WebhookFetch;
	onDeliveryError?: (context: {
		endpoint: WebhookEndpoint;
		error: unknown;
		event: WebhookEvent;
	}) => void | Promise<void>;
	timeoutMs?: number;
};
