import { describe, expect, test } from 'bun:test';
import { composeCallbackAudit } from '../src/audit/wrap';
import type { AuditEvent } from '../src/audit/types';

const context = {
	authProvider: 'github'
};

describe('OAuth callback audit', () => {
	test('emits login only after the consumer callback succeeds', async () => {
		const events: AuditEvent[] = [];
		const callback = composeCallbackAudit(
			async () => undefined,
			async (event) => {
				events.push(event);
			}
		);

		await callback(context);

		expect(events.map((event) => event.type)).toEqual(['oauth_login']);
	});

	test('does not record a failed callback as a login', async () => {
		const events: AuditEvent[] = [];
		const callback = composeCallbackAudit(
			async () => new Response('failed', { status: 500 }),
			async (event) => {
				events.push(event);
			}
		);

		const response = await callback(context);

		expect(response).toBeInstanceOf(Response);
		expect(events).toHaveLength(0);
	});
});
