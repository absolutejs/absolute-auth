// PostHog server-side identify. Pair with audit events that have a `userId` (register,
// credentials_login, oauth_login, …) to push the user to PostHog with their
// email/properties so server-side events tie back to the right person.
//
// ~25 lines; one POST per event. Drop into the audit chain via composition or use as
// an `AuditSink` directly.

import type { AuditEvent, AuditSink } from '../audit/types';

export type PosthogIdentifyOptions = {
	host?: string; // defaults to PostHog Cloud US
	projectApiKey: string;
	// Pull the properties to send from the audit event metadata + your own enrichment.
	properties?: (event: AuditEvent) => Record<string, unknown>;
};

const DEFAULT_HOST = 'https://us.i.posthog.com';

export const posthogIdentifyPlugin = ({
	host = DEFAULT_HOST,
	projectApiKey,
	properties = (event) => ({ ...(event.metadata ?? {}) })
}: PosthogIdentifyOptions): AuditSink => ({
	append: async (event) => {
		if (event.userId === undefined) return;
		await fetch(`${host}/capture/`, {
			body: JSON.stringify({
				api_key: projectApiKey,
				distinct_id: event.userId,
				event: '$identify',
				properties: {
					$set: properties(event),
					$set_once: { first_seen_event: event.type }
				},
				timestamp: new Date(event.at).toISOString()
			}),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		}).catch(() => undefined);
	}
});
