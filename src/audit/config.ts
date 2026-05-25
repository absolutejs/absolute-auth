import type { AuditEvent, AuditSink } from './types';

export type AuditConfig<UserType> = {
	auditStore?: AuditSink;
	// Optional extractor for the stable user id recorded on events that carry a user.
	getUserId?: (user: UserType) => string;
	// Additional consumer sink (forward to a SIEM, etc.) fired alongside `auditStore`.
	onAuditEvent?: (event: AuditEvent) => void | Promise<void>;
	// Optional PII redaction applied to every event before it reaches any sink (E5). See
	// `createAuditRedactor` for a configurable drop/hash redactor.
	redact?: (event: AuditEvent) => AuditEvent | Promise<AuditEvent>;
};

export type AuditEmitter = (event: AuditEvent) => Promise<void>;

export const createAuditEmitter =
	<UserType>({ auditStore, onAuditEvent, redact }: AuditConfig<UserType>) =>
	async (event: AuditEvent) => {
		const finalEvent = redact ? await redact(event) : event;
		await auditStore?.append(finalEvent);
		await onAuditEvent?.(finalEvent);
	};
