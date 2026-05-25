import type { AuditEvent } from '../audit/types';
import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { DEFAULT_WEBHOOK_TIMEOUT_MS, type WebhooksConfig } from './config';
import { signWebhook } from './sign';
import type { WebhookEvent } from './types';

// Build a dispatcher that signs an event and POSTs it to every configured endpoint in parallel.
// Delivery is best-effort and per-endpoint isolated: a failure is reported via `onDeliveryError`
// and never thrown, so a dead endpoint cannot break the auth flow that produced the event.
export const createWebhookDispatcher = ({
	endpoints,
	fetch: fetchImpl = globalThis.fetch,
	onDeliveryError,
	timeoutMs = DEFAULT_WEBHOOK_TIMEOUT_MS
}: WebhooksConfig) => {
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
			endpoints.map(async (endpoint) => {
				try {
					const signature = await signWebhook({
						id: envelope.id,
						payload,
						secret: endpoint.secret,
						timestamp
					});
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
						throw new Error(
							`Webhook delivery returned ${response.status}`
						);
					}
				} catch (error) {
					await onDeliveryError?.({
						endpoint,
						error,
						event: envelope
					});
				}
			})
		);
	};

	return dispatch;
};
