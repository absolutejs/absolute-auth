import { MILLISECONDS_IN_A_SECOND } from '../constants';
import type {
	WebhookDeliveryStore,
	WebhookEndpoint,
	WebhookEvent
} from './types';

const DEFAULT_TIMEOUT_SECONDS = 5;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_INITIAL_DELAY_MS = MILLISECONDS_IN_A_SECOND;
const DEFAULT_RETRY_BACKOFF_MULTIPLIER = 2;

// Defaults: 3 total attempts with delays 1000ms, 2000ms between them
// (total worst-case ~3s of waiting on top of the per-attempt timeouts).
export const DEFAULT_WEBHOOK_RETRY = {
	attempts: DEFAULT_RETRY_ATTEMPTS,
	backoffMultiplier: DEFAULT_RETRY_BACKOFF_MULTIPLIER,
	initialDelayMs: DEFAULT_RETRY_INITIAL_DELAY_MS
} as const;

export const DEFAULT_WEBHOOK_TIMEOUT_MS =
	MILLISECONDS_IN_A_SECOND * DEFAULT_TIMEOUT_SECONDS;

// Retry policy for a failed delivery (network error or non-2xx response). `attempts` is the TOTAL
// number of HTTP attempts (≥1; `1` disables retry). Backoff between attempt `i` and attempt `i+1`
// is `initialDelayMs * backoffMultiplier^i`. After all attempts fail, `onDeliveryError` fires and
// (if configured) the envelope is persisted to the `deliveryStore` DLQ for inspection/replay.
export type WebhookRetryConfig = {
	attempts?: number;
	backoffMultiplier?: number;
	initialDelayMs?: number;
};

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
	// Optional dead-letter queue. Final-failure envelopes are persisted here AFTER
	// `onDeliveryError` fires, so consumers can list / replay / remove them out-of-band.
	deliveryStore?: WebhookDeliveryStore;
	endpoints: WebhookEndpoint[];
	// Override the HTTP client (testing, proxy, custom retries). Defaults to global fetch.
	fetch?: WebhookFetch;
	onDeliveryError?: (context: {
		endpoint: WebhookEndpoint;
		error: unknown;
		event: WebhookEvent;
	}) => void | Promise<void>;
	retry?: WebhookRetryConfig;
	sleep?: (ms: number) => Promise<void>;
	timeoutMs?: number;
};
