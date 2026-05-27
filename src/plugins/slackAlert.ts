// Slack webhook plugin. Pair with `audit.onAuditEvent` OR drop into the audit chain
// (it's a valid `AuditSink`) to post a one-line summary of chosen audit events to a
// Slack channel webhook. Fire-and-forget, ~30 lines — copy + modify if you want a
// different message shape.

import type { AuditEvent, AuditEventType, AuditSink } from '../audit/types';

export type SlackAlertOptions = {
	// Optional event-type allow-list. Without it, EVERY event posts — typically you
	// want to filter to security-relevant events like login failures + MFA failures.
	events?: readonly AuditEventType[];
	// Build the Slack message body from the event. Default is one short line; override
	// to use Block Kit, attachments, mentions, etc.
	formatMessage?: (event: AuditEvent) => string;
	webhookUrl: string;
};

const defaultFormat = (event: AuditEvent) => {
	const when = new Date(event.at).toISOString();
	const who = event.userId ?? event.ip ?? 'unknown';

	return `🔐 *${event.type}* — ${who} at ${when}`;
};

export const slackAlertPlugin = ({
	events,
	formatMessage = defaultFormat,
	webhookUrl
}: SlackAlertOptions): AuditSink => ({
	append: async (event) => {
		if (events !== undefined && !events.includes(event.type)) return;
		await fetch(webhookUrl, {
			body: JSON.stringify({ text: formatMessage(event) }),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		}).catch(() => undefined);
	}
});
