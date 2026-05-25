import { describe, expect, mock, test } from 'bun:test';
import {
	createTamperEvidentSink,
	verifyAuditChain
} from '../src/audit/integrity';
import { createSiemLogStream } from '../src/audit/siem';
import type { AuditEvent, AuditSink } from '../src/audit/types';

const captureSink = () => {
	const events: AuditEvent[] = [];

	const sink: AuditSink = {
		append: async (event) => {
			events.push(event);
		},
		list: async (filter) => [...events].reverse().slice(0, filter?.limit)
	};

	return { events, sink };
};

const append = async (sink: AuditSink) => {
	await sink.append({ at: 1, type: 'register', userId: 'u1' });
	await sink.append({ at: 2, type: 'credentials_login', userId: 'u1' });
	await sink.append({ at: 3, type: 'mfa_challenge', userId: 'u1' });
};

describe('tamper-evident audit', () => {
	test('a clean chain verifies', async () => {
		const { events, sink } = captureSink();
		await append(createTamperEvidentSink({ secret: 'k', sink }));

		expect(await verifyAuditChain(events, 'k')).toEqual({ ok: true });
	});

	test('modifying any event breaks the chain at that index', async () => {
		const { events, sink } = captureSink();
		await append(createTamperEvidentSink({ secret: 'k', sink }));

		const target = events[1];
		if (target) target.type = 'logout'; // tamper

		expect(await verifyAuditChain(events, 'k')).toEqual({
			brokenAt: 1,
			ok: false
		});
	});

	test('removing an event breaks the chain', async () => {
		const { events, sink } = captureSink();
		await append(createTamperEvidentSink({ secret: 'k', sink }));

		const without = [events[0], events[2]].filter(
			(event): event is AuditEvent => event !== undefined
		);

		expect((await verifyAuditChain(without, 'k')).ok).toBe(false);
	});

	test('the wrong secret fails verification', async () => {
		const { events, sink } = captureSink();
		await append(createTamperEvidentSink({ secret: 'k', sink }));

		expect((await verifyAuditChain(events, 'wrong')).ok).toBe(false);
	});
});

describe('SIEM log stream', () => {
	test('forwards each event to every endpoint with the right shape', async () => {
		const calls: { body: string; url: string }[] = [];
		const fetchMock = mock(async (url: string, init: { body: string }) => {
			calls.push({ body: init.body, url });

			return new Response('{}');
		});
		const original = globalThis.fetch;
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test stub for fetch
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		try {
			const stream = createSiemLogStream({
				endpoints: [
					{ format: 'datadog', token: 'dd', url: 'https://dd.example' },
					{ format: 'splunk', token: 'sp', url: 'https://splunk.example' }
				]
			});
			await stream.append({ at: 1, type: 'oauth_login', userId: 'u1' });
		} finally {
			globalThis.fetch = original;
		}

		expect(calls).toHaveLength(2);
		const datadog = calls.find((call) => call.url === 'https://dd.example');
		expect(JSON.parse(datadog?.body ?? '{}').ddsource).toBe(
			'absolutejs-auth'
		);
	});
});
