import type { AuditEvent } from './types';

// Export audit events to CSV (header + one row per event) — the parity piece to WorkOS's CSV
// export. Columns: at (ISO 8601), type, userId, ip, organizationId, metadata (JSON). Pass the
// events in whatever order you want them in the file (e.g. `list()` then `.reverse()` for
// oldest-first). Fields are RFC-4180 quoted/escaped, so the JSON metadata round-trips safely.

const CSV_HEADER = 'at,type,userId,ip,organizationId,metadata';

const escapeCsv = (value: string) =>
	/[",\n\r]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;

const toRow = (event: AuditEvent) =>
	[
		new Date(event.at).toISOString(),
		event.type,
		event.userId ?? '',
		event.ip ?? '',
		event.organizationId ?? '',
		event.metadata ? JSON.stringify(event.metadata) : ''
	]
		.map(escapeCsv)
		.join(',');

export const exportAuditCsv = (events: AuditEvent[]) =>
	[CSV_HEADER, ...events.map(toRow)].join('\n');
