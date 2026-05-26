import type { AuditEvent } from '../audit/types';
import { MILLISECONDS_IN_A_SECOND } from '../constants';
import {
	DEFAULT_WEBHOOK_RETRY,
	DEFAULT_WEBHOOK_TIMEOUT_MS,
	type WebhookFetch,
	type WebhookRetryConfig,
	type WebhooksConfig
} from './config';
import { signWebhook } from './sign';
import type {
	WebhookDelivery,
	WebhookDeliveryStore,
	WebhookEndpoint,
	WebhookEvent
} from './types';

const defaultSleep = (delayMs: number) =>
	// eslint-disable-next-line promise/avoid-new -- a setTimeout-backed delay needs the bare Promise constructor
	new Promise<void>((resolve) => setTimeout(resolve, delayMs));

const attemptOnce = async ({
	envelope,
	endpoint,
	fetchImpl,
	payload,
	signature,
	timeoutMs,
	timestamp
}: {
	endpoint: WebhookEndpoint;
	envelope: WebhookEvent;
	fetchImpl: WebhookFetch;
	payload: string;
	signature: string;
	timeoutMs: number;
	timestamp: string;
}) => {
	const response = await fetchImpl(endpoint.url, {
		body: payload,
		headers: {
			'content-type': 'application/json',
			'webhook-id': envelope.id,
			'webhook-signature': signature,
			'webhook-timestamp': timestamp
		},
		method: 'POST',
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!response.ok) {
		throw new Error(`Webhook delivery returned ${response.status}`);
	}

	return response.status;
};

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const statusFromError = (error: unknown) => {
	if (!(error instanceof Error)) return undefined;
	const match = /returned (\d+)/.exec(error.message);

	return match?.[1] === undefined ? undefined : Number(match[1]);
};

const persistFailure = async ({
	attempts,
	deliveryStore,
	endpoint,
	envelope,
	lastError
}: {
	attempts: number;
	deliveryStore: WebhookDeliveryStore | undefined;
	endpoint: WebhookEndpoint;
	envelope: WebhookEvent;
	lastError: unknown;
}) => {
	if (deliveryStore === undefined) return;
	const record: WebhookDelivery = {
		attempts,
		createdAt: Date.now(),
		endpointUrl: endpoint.url,
		envelope,
		lastError: errorMessage(lastError),
		lastStatus: statusFromError(lastError)
	};
	await deliveryStore.recordFailure(record);
};

// One full attempt cycle: try to deliver; on failure, sleep before the next attempt (no sleep
// after the final attempt). Returns the caught error (or `undefined` on success) so the caller's
// loop body stays a single statement and depth-1.
const tryDeliverThenBackoff = async ({
	attempt,
	endpoint,
	envelope,
	fetchImpl,
	payload,
	retry,
	signature,
	sleep,
	timeoutMs,
	timestamp
}: {
	attempt: number;
	endpoint: WebhookEndpoint;
	envelope: WebhookEvent;
	fetchImpl: WebhookFetch;
	payload: string;
	retry: Required<WebhookRetryConfig>;
	signature: string;
	sleep: (delayMs: number) => Promise<void>;
	timeoutMs: number;
	timestamp: string;
}) => {
	try {
		await attemptOnce({
			endpoint,
			envelope,
			fetchImpl,
			payload,
			signature,
			timeoutMs,
			timestamp
		});

		return undefined;
	} catch (error) {
		const isLastAttempt = attempt >= retry.attempts - 1;
		await (isLastAttempt
			? Promise.resolve()
			: sleep(
					retry.initialDelayMs *
						retry.backoffMultiplier ** attempt
				));

		return error;
	}
};

// Drive one endpoint's delivery to either success or permanent failure. Returns nothing —
// failures are reported via `onDeliveryError` + persisted to the optional DLQ. A throw inside
// the per-endpoint isolation would block sibling deliveries through Promise.all, so we swallow
// everything past the last attempt.
const deliverToEndpoint = async ({
	deliveryStore,
	endpoint,
	envelope,
	fetchImpl,
	onDeliveryError,
	payload,
	retry,
	signature,
	sleep,
	timeoutMs,
	timestamp
}: {
	deliveryStore: WebhookDeliveryStore | undefined;
	endpoint: WebhookEndpoint;
	envelope: WebhookEvent;
	fetchImpl: WebhookFetch;
	onDeliveryError: WebhooksConfig['onDeliveryError'];
	payload: string;
	retry: Required<WebhookRetryConfig>;
	signature: string;
	sleep: (delayMs: number) => Promise<void>;
	timeoutMs: number;
	timestamp: string;
}) => {
	let lastError: unknown;
	for (let attempt = 0; attempt < retry.attempts; attempt++) {
		// eslint-disable-next-line no-await-in-loop -- retry-with-backoff is inherently sequential
		const error = await tryDeliverThenBackoff({
			attempt,
			endpoint,
			envelope,
			fetchImpl,
			payload,
			retry,
			signature,
			sleep,
			timeoutMs,
			timestamp
		});
		if (error === undefined) return;
		lastError = error;
	}

	await onDeliveryError?.({
		endpoint,
		error: lastError,
		event: envelope
	});
	await persistFailure({
		attempts: retry.attempts,
		deliveryStore,
		endpoint,
		envelope,
		lastError
	});
};

// Build a dispatcher that signs an event and POSTs it to every configured endpoint in parallel.
// Delivery is best-effort and per-endpoint isolated: retries follow the configured backoff, a
// permanently failed delivery is surfaced via `onDeliveryError` AND persisted to the optional
// `deliveryStore` DLQ for later inspection/replay. Per-endpoint `events` filters skip endpoints
// that didn't subscribe to this event type.
export const createWebhookDispatcher = ({
	deliveryStore,
	endpoints,
	fetch: fetchImpl = globalThis.fetch,
	onDeliveryError,
	retry,
	sleep = defaultSleep,
	timeoutMs = DEFAULT_WEBHOOK_TIMEOUT_MS
}: WebhooksConfig) => {
	const effectiveRetry: Required<WebhookRetryConfig> = {
		attempts: retry?.attempts ?? DEFAULT_WEBHOOK_RETRY.attempts,
		backoffMultiplier:
			retry?.backoffMultiplier ??
			DEFAULT_WEBHOOK_RETRY.backoffMultiplier,
		initialDelayMs:
			retry?.initialDelayMs ?? DEFAULT_WEBHOOK_RETRY.initialDelayMs
	};

	const dispatch = async (event: AuditEvent) => {
		const envelope: WebhookEvent = {
			createdAt: Date.now(),
			data: event,
			id: crypto.randomUUID(),
			type: event.type
		};
		const payload = JSON.stringify(envelope);
		const timestamp = Math.floor(
			Date.now() / MILLISECONDS_IN_A_SECOND
		).toString();

		await Promise.all(
			endpoints
				.filter(
					(endpoint) =>
						endpoint.events === undefined ||
						endpoint.events.includes(event.type)
				)
				.map(async (endpoint) => {
					const signature = await signWebhook({
						id: envelope.id,
						payload,
						secret: endpoint.secret,
						timestamp
					});
					await deliverToEndpoint({
						deliveryStore,
						endpoint,
						envelope,
						fetchImpl,
						onDeliveryError,
						payload,
						retry: effectiveRetry,
						signature,
						sleep,
						timeoutMs,
						timestamp
					});
				})
		);
	};

	return dispatch;
};
