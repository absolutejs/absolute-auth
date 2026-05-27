// Discord webhook plugin — same shape as slackAlert, slightly different payload.
// ~20 lines; copy + modify if you want embeds, mentions, etc.

import type { AuditEvent, AuditEventType, AuditSink } from '../audit/types';

export type DiscordAlertOptions = {
	events?: readonly AuditEventType[];
	formatContent?: (event: AuditEvent) => string;
	webhookUrl: string;
};

const defaultContent = (event: AuditEvent) => {
	const when = new Date(event.at).toISOString();
	const who = event.userId ?? event.ip ?? 'unknown';

	return `🔐 **${event.type}** — ${who} at ${when}`;
};

export const discordAlertPlugin = ({
	events,
	formatContent = defaultContent,
	webhookUrl
}: DiscordAlertOptions): AuditSink => ({
	append: async (event) => {
		if (events !== undefined && !events.includes(event.type)) return;
		await fetch(webhookUrl, {
			body: JSON.stringify({ content: formatContent(event) }),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		}).catch(() => undefined);
	}
});
