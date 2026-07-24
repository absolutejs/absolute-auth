import { describe, expect, mock, test } from 'bun:test';
import { exportAuditCsv } from '../src/audit/export';
import {
	createTamperEvidentSink,
	verifyAuditChain
} from '../src/audit/integrity';
import { createInMemoryAuditSink } from '../src/audit/inMemoryAuditStore';
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

		const [, target] = events;
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

	test('two writers interleaved into one sink each verify (sharded)', async () => {
		const { events, sink } = captureSink();
		const writerA = createTamperEvidentSink({
			secret: 'k',
			sink,
			writerId: 'a'
		});
		const writerB = createTamperEvidentSink({
			secret: 'k',
			sink,
			writerId: 'b'
		});

		// Interleave appends — the failure mode that broke a single global chain.
		await writerA.append({ at: 1, type: 'register', userId: 'u1' });
		await writerB.append({ at: 2, type: 'oauth_login', userId: 'u2' });
		await writerA.append({
			at: 3,
			type: 'credentials_login',
			userId: 'u1'
		});
		await writerB.append({ at: 4, type: 'logout', userId: 'u2' });

		expect(await verifyAuditChain(events, 'k')).toEqual({ ok: true });
	});

	test('sharded: tampering one writer event is still detected', async () => {
		const { events, sink } = captureSink();
		const writerA = createTamperEvidentSink({
			secret: 'k',
			sink,
			writerId: 'a'
		});
		const writerB = createTamperEvidentSink({
			secret: 'k',
			sink,
			writerId: 'b'
		});
		await writerA.append({ at: 1, type: 'register', userId: 'u1' });
		await writerB.append({ at: 2, type: 'oauth_login', userId: 'u2' });
		await writerA.append({ at: 3, type: 'mfa_challenge', userId: 'u1' });

		const target = events.find((event) => event.type === 'oauth_login');
		if (target) target.type = 'logout';

		expect((await verifyAuditChain(events, 'k')).ok).toBe(false);
	});

	test('a stable writerId resumes its chain across instances', async () => {
		const { events, sink } = captureSink();
		// First "instance" writes one event, then a fresh instance with the same
		// writerId resumes the chain (seeded from the store).
		await createTamperEvidentSink({
			secret: 'k',
			sink,
			writerId: 'svc'
		}).append({ at: 1, type: 'register', userId: 'u1' });
		await createTamperEvidentSink({
			secret: 'k',
			sink,
			writerId: 'svc'
		}).append({ at: 2, type: 'credentials_login', userId: 'u1' });

		expect(await verifyAuditChain(events, 'k')).toEqual({ ok: true });
	});
});

describe('SIEM log stream', () => {
	test('forwards each event to every endpoint with the right shape', async () => {
		const calls: { body: string; url: string }[] = [];
		const fetchMock: typeof fetch = mock(async (input, init) => {
			calls.push({
				body: String(init?.body ?? ''),
				url: input.toString()
			});

			return new Response('{}');
		});
		const original = globalThis.fetch;
		globalThis.fetch = fetchMock;

		try {
			const stream = createSiemLogStream({
				endpoints: [
					{
						format: 'datadog',
						token: 'dd',
						url: 'https://dd.example'
					},
					{
						format: 'splunk',
						token: 'sp',
						url: 'https://splunk.example'
					}
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

describe('audit retention + CSV export', () => {
	test('prune removes events older than the cutoff', async () => {
		const sink = createInMemoryAuditSink();
		await sink.append({ at: 1000, type: 'register', userId: 'u1' });
		await sink.append({
			at: 2000,
			type: 'credentials_login',
			userId: 'u1'
		});
		await sink.append({ at: 3000, type: 'logout', userId: 'u1' });

		const removed = await sink.prune?.(2000);
		expect(removed).toBe(1); // only at:1000 is < 2000

		const remaining = (await sink.list?.()) ?? [];
		expect(remaining.map((event) => event.at).sort()).toEqual([2000, 3000]);
	});

	test('exportAuditCsv renders a header + a plain row', () => {
		const csv = exportAuditCsv([{ at: 0, type: 'register', userId: 'u1' }]);
		const lines = csv.split('\n');
		expect(lines[0]).toBe('at,type,userId,ip,organizationId,metadata');
		expect(lines[1]).toBe('1970-01-01T00:00:00.000Z,register,u1,,,');
	});

	test('exportAuditCsv quotes + escapes fields with commas/quotes', () => {
		const csv = exportAuditCsv([
			{ at: 0, metadata: { note: 'a,b' }, type: 'register' }
		]);
		// metadata JSON has a comma + quotes -> wrapped, inner quotes doubled
		expect(csv.split('\n')[1]).toBe(
			'1970-01-01T00:00:00.000Z,register,,,,"{""note"":""a,b""}"'
		);
	});
});
