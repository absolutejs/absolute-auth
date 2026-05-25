import type { AuditEvent } from '../audit/types';
import { hashToken } from '../crypto';

type AuditRedactorOptions = {
	// Metadata keys whose values are removed entirely before the event reaches any sink.
	dropFields?: string[];
	// Metadata keys whose values are replaced with a stable SHA-256 hash — pseudonymized so the
	// same input still correlates across events without retaining the raw PII.
	hashFields?: string[];
	// When true, the top-level `ip` is dropped from every event.
	redactIp?: boolean;
};

// Builds an audit redactor for `AuditConfig.redact`: it drops and/or pseudonymizes configured PII
// fields (e.g. `email`) in event metadata before the event is persisted. Hashing keeps events
// correlatable without storing raw identifiers.
export const createAuditRedactor =
	({
		dropFields = [],
		hashFields = [],
		redactIp = false
	}: AuditRedactorOptions) =>
	async (event: AuditEvent) => {
		const { metadata } = event;
		if (metadata === undefined) {
			return redactIp ? { ...event, ip: undefined } : event;
		}

		const redacted: Record<string, unknown> = { ...metadata };
		for (const field of dropFields) delete redacted[field];
		await Promise.all(
			hashFields.map(async (field) => {
				const value = redacted[field];
				if (typeof value === 'string') {
					redacted[field] = await hashToken(value);
				}
			})
		);

		return {
			...event,
			ip: redactIp ? undefined : event.ip,
			metadata: redacted
		};
	};
