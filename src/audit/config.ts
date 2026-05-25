import type { AuditEvent, AuditSink } from './types';

export type AuditConfig<UserType> = {
	auditStore?: AuditSink;
	// Optional extractor for the stable user id recorded on events that carry a user.
	getUserId?: (user: UserType) => string;
	// Additional consumer sink (forward to a SIEM, etc.) fired alongside `auditStore`.
	onAuditEvent?: (event: AuditEvent) => void | Promise<void>;
};

export type AuditEmitter = (event: AuditEvent) => Promise<void>;

export const createAuditEmitter =
	<UserType>({ auditStore, onAuditEvent }: AuditConfig<UserType>) =>
	async (event: AuditEvent) => {
		await auditStore?.append(event);
		await onAuditEvent?.(event);
	};
