import type { AuditEvent, AuditSink } from './types';

export const createInMemoryAuditSink = (): AuditSink => {
	const events: AuditEvent[] = [];

	return {
		append: async (event) => {
			events.push({ ...event });
		},
		list: async (filter) => {
			const matched = filter?.userId
				? events.filter((event) => event.userId === filter.userId)
				: events;
			const ordered = [...matched].sort((left, right) => right.at - left.at);
			const limited =
				filter?.limit === undefined
					? ordered
					: ordered.slice(0, filter.limit);

			return limited.map((event) => ({ ...event }));
		}
	};
};
