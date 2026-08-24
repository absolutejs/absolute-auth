import { describe, expect, test } from 'bun:test';
import { createInMemorySocketTicketStore } from '../src/oidc/inMemoryStores';
import {
	consumeSocketTicket,
	issueSocketTicket
} from '../src/oidc/socketTickets';

describe('WebSocket tickets', () => {
	test('is hashed at rest, audience-bound, short-lived, and single-use', async () => {
		const store = createInMemorySocketTicketStore();
		const now = 1_000;
		const issued = await issueSocketTicket({
			audience: 'https://api.example/sync',
			clientId: 'mobile-app',
			now,
			scopes: ['sync:read'],
			store,
			subject: 'user-1',
			ttlMs: 500
		});
		expect(issued.ticket).toStartWith('ast_');

		const principal = await consumeSocketTicket({
			audience: 'https://api.example/sync',
			now: now + 100,
			store,
			ticket: issued.ticket,
			getUser: (subject) => ({ subject })
		});
		expect(principal).toMatchObject({
			clientId: 'mobile-app',
			kind: 'access-token',
			scopes: ['sync:read'],
			subject: 'user-1',
			user: { subject: 'user-1' }
		});
		expect(
			await consumeSocketTicket({
				audience: 'https://api.example/sync',
				store,
				ticket: issued.ticket,
				getUser: (subject) => ({ subject })
			})
		).toBeUndefined();
	});

	test('consumes and rejects expired or wrong-audience tickets', async () => {
		const store = createInMemorySocketTicketStore();
		const expired = await issueSocketTicket({
			audience: 'sync',
			clientId: 'app',
			now: 1_000,
			scopes: [],
			store,
			subject: 'user',
			ttlMs: 10
		});
		expect(
			await consumeSocketTicket({
				audience: 'sync',
				now: 1_011,
				store,
				ticket: expired.ticket,
				getUser: () => ({})
			})
		).toBeUndefined();

		const wrongAudience = await issueSocketTicket({
			audience: 'sync-a',
			clientId: 'app',
			scopes: [],
			store,
			subject: 'user'
		});
		expect(
			await consumeSocketTicket({
				audience: 'sync-b',
				store,
				ticket: wrongAudience.ticket,
				getUser: () => ({})
			})
		).toBeUndefined();
		expect(
			await consumeSocketTicket({
				audience: 'sync-a',
				store,
				ticket: wrongAudience.ticket,
				getUser: () => ({})
			})
		).toBeUndefined();
	});
});
