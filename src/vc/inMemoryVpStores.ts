// In-memory PresentationRequestStore. Postgres flavor deferred — same shape as the rest of
// the VC stores.

import type {
	PresentationRequest,
	PresentationRequestStore
} from './openid4vp';

export const createInMemoryPresentationRequestStore =
	(): PresentationRequestStore => {
		const requests = new Map<string, PresentationRequest>();

		return {
			consumeRequest: async (requestId) => {
				const request = requests.get(requestId);
				if (request === undefined) return undefined;
				requests.delete(requestId);

				return request;
			},
			getRequest: async (requestId) => requests.get(requestId),
			saveRequest: async (request) => {
				requests.set(request.requestId, request);
			}
		};
	};
