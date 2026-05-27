// PagerDuty Events API v2 plugin. Posts a trigger event to a PagerDuty service —
// pair with security-critical audit events (credentials_login_failed, mfa_challenge_failed,
// impersonation_started) by passing `events: [...]`. Severity defaults to 'warning' but
// most consumers wire 'critical' for these.
//
// Get a routing key from a PagerDuty integration: Service → Integrations → +Add → Events API v2.

import type { AuditEventType, AuditSink } from '../audit/types';

const PAGERDUTY_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

export type PagerDutySeverity = 'critical' | 'error' | 'info' | 'warning';

export type PagerDutyAlertOptions = {
	events?: readonly AuditEventType[];
	routingKey: string;
	severity?: PagerDutySeverity;
	// Optional source identifier (e.g. your service name) for grouping in PagerDuty.
	source?: string;
};

export const pagerdutyAlertPlugin = ({
	events,
	routingKey,
	severity = 'warning',
	source = 'absolutejs-auth'
}: PagerDutyAlertOptions): AuditSink => ({
	append: async (event) => {
		if (events !== undefined && !events.includes(event.type)) return;
		await fetch(PAGERDUTY_EVENTS_URL, {
			body: JSON.stringify({
				event_action: 'trigger',
				payload: {
					custom_details: event.metadata ?? {},
					severity,
					source,
					summary: `auth event: ${event.type} (user=${event.userId ?? 'unknown'})`,
					timestamp: new Date(event.at).toISOString()
				},
				routing_key: routingKey
			}),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		}).catch(() => undefined);
	}
});
