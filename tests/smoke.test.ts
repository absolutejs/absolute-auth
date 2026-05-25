import { describe, expect, test } from 'bun:test';
import {
	createTestSessionData,
	createTestSessionStore,
	TEST_SESSION_ID
} from './setup';

describe('in-memory auth session store', () => {
	test('round-trips a session by id', async () => {
		const store = createTestSessionStore();
		const data = createTestSessionData();

		await store.setSession(TEST_SESSION_ID, data);
		const loaded = await store.getSession(TEST_SESSION_ID);

		expect(loaded?.user.email).toBe('user@example.com');
		expect(loaded?.accessToken).toBe('test-access-token');
	});

	test('removes a session', async () => {
		const store = createTestSessionStore();

		await store.setSession(TEST_SESSION_ID, createTestSessionData());
		await store.removeSession(TEST_SESSION_ID);

		expect(await store.getSession(TEST_SESSION_ID)).toBeUndefined();
	});
});
