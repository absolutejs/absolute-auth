import type { WebhookDelivery, WebhookDeliveryStore } from './types';

const DEFAULT_LIST_LIMIT = 100;

export const createInMemoryWebhookDeliveryStore = (): WebhookDeliveryStore => {
	const failures = new Map<string, WebhookDelivery>();

	return {
		listFailed: async (limit = DEFAULT_LIST_LIMIT) =>
			Array.from(failures.values())
				.sort((left, right) => right.createdAt - left.createdAt)
				.slice(0, limit),
		recordFailure: async (delivery) => {
			failures.set(delivery.envelope.id, delivery);
		},
		removeFailure: async (envelopeId) => {
			failures.delete(envelopeId);
		}
	};
};
