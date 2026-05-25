import type { AuditEvent, AuditSink } from './types';

// SIEM log streaming — the parity piece to WorkOS "Log Streams": forward every audit event
// to one or more SIEM / log endpoints. Built-in formats for Datadog and Splunk HEC, plus a
// generic JSON POST for anything else (S3-via-proxy, an HTTP collector, …). Delivery is
// best-effort and isolated per endpoint so one slow/broken sink can't block the others or
// the auth flow. Wire it as the audit `auditStore` (or via `onAuditEvent` alongside a durable
// store).

export type SiemFormat = 'datadog' | 'generic' | 'splunk';

export type SiemEndpoint = {
	format?: SiemFormat;
	headers?: Record<string, string>;
	token?: string;
	url: string;
};

const SOURCE = 'absolutejs-auth';

const requestFor = (endpoint: SiemEndpoint, event: AuditEvent) => {
	const base: Record<string, string> = {
		'content-type': 'application/json',
		...endpoint.headers
	};

	if (endpoint.format === 'datadog') {
		return {
			body: JSON.stringify({
				...event,
				ddsource: SOURCE,
				service: SOURCE
			}),
			headers:
				endpoint.token === undefined
					? base
					: { ...base, 'DD-API-KEY': endpoint.token }
		};
	}

	if (endpoint.format === 'splunk') {
		return {
			body: JSON.stringify({ event, sourcetype: SOURCE }),
			headers:
				endpoint.token === undefined
					? base
					: { ...base, authorization: `Splunk ${endpoint.token}` }
		};
	}

	return {
		body: JSON.stringify(event),
		headers:
			endpoint.token === undefined
				? base
				: { ...base, authorization: `Bearer ${endpoint.token}` }
	};
};

export const createSiemLogStream = ({
	endpoints
}: {
	endpoints: SiemEndpoint[];
}): AuditSink => ({
	append: async (event) => {
		await Promise.all(
			endpoints.map(async (endpoint) => {
				const { body, headers } = requestFor(endpoint, event);
				await fetch(endpoint.url, {
					body,
					headers,
					method: 'POST'
				}).catch(() => undefined);
			})
		);
	}
});
