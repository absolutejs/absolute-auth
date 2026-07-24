import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { auth } from '../src/index';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { createWebhookDispatcher } from '../src/webhooks/dispatcher';
import { createInMemoryWebhookDeliveryStore } from '../src/webhooks/inMemoryStore';
import { signWebhook, verifyWebhookSignature } from '../src/webhooks/sign';

type TestUser = {
	email: string;
	sub: string;
};

type CapturedRequest = {
	body: string;
	headers: Record<string, string>;
	url: string;
};

const SECRET = 'whsec-test-secret';
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;

const recordingFetch =
	(captured: CapturedRequest[], succeeds = true) =>
	async (
		url: string,
		init: { body: string; headers: Record<string, string> }
	) => {
		captured.push({ body: init.body, headers: init.headers, url });

		return {
			ok: succeeds,
			status: succeeds ? HTTP_OK : HTTP_SERVER_ERROR
		};
	};

describe('webhook signing', () => {
	test('verifies a signature produced for the same payload + secret', async () => {
		const payload = '{"hello":"world"}';
		const signature = await signWebhook({
			id: 'msg_1',
			payload,
			secret: SECRET,
			timestamp: '1700000000'
		});
		const headers: Record<string, string> = {
			'webhook-id': 'msg_1',
			'webhook-signature': signature,
			'webhook-timestamp': '1700000000'
		};

		expect(
			await verifyWebhookSignature({ headers, payload, secret: SECRET })
		).toBe(true);
		expect(
			await verifyWebhookSignature({
				headers,
				payload,
				secret: 'wrong-secret'
			})
		).toBe(false);
	});
});

describe('webhook dispatcher', () => {
	test('signs and POSTs a verifiable envelope to each endpoint', async () => {
		const captured: CapturedRequest[] = [];
		const dispatch = createWebhookDispatcher({
			endpoints: [{ secret: SECRET, url: 'https://hooks.test/a' }],
			fetch: recordingFetch(captured)
		});

		await dispatch({ at: Date.now(), type: 'register', userId: 'u1' });

		expect(captured).toHaveLength(1);
		const [request] = captured;
		expect(request?.url).toBe('https://hooks.test/a');
		expect(JSON.parse(request?.body ?? '{}').data.type).toBe('register');
		expect(
			await verifyWebhookSignature({
				headers: request?.headers ?? {},
				payload: request?.body ?? '',
				secret: SECRET
			})
		).toBe(true);
	});

	test('reports a non-2xx delivery through onDeliveryError without throwing', async () => {
		const errors: unknown[] = [];
		const dispatch = createWebhookDispatcher({
			endpoints: [{ secret: SECRET, url: 'https://hooks.test/down' }],
			fetch: recordingFetch([], false),
			onDeliveryError: ({ error }) => {
				errors.push(error);
			}
		});

		await dispatch({ at: Date.now(), type: 'logout' });

		expect(errors).toHaveLength(1);
	});
});

describe('webhook dispatcher — retry + DLQ', () => {
	test('retries failed deliveries with exponential backoff and succeeds on the 3rd attempt', async () => {
		const captured: CapturedRequest[] = [];
		const sleeps: number[] = [];
		let calls = 0;
		const dispatch = createWebhookDispatcher({
			endpoints: [{ secret: SECRET, url: 'https://hooks.test/flaky' }],
			retry: { attempts: 3, initialDelayMs: 10 },
			fetch: async (url, init) => {
				captured.push({
					body: init.body,
					headers: init.headers,
					url
				});
				calls += 1;

				return calls < 3
					? { ok: false, status: HTTP_SERVER_ERROR }
					: { ok: true, status: HTTP_OK };
			},
			sleep: async (delayMs) => {
				sleeps.push(delayMs);
			}
		});

		await dispatch({ at: Date.now(), type: 'mfa_challenge_failed' });

		expect(calls).toBe(3);
		expect(sleeps).toEqual([10, 20]);
	});

	test('persists permanent failures to the delivery store DLQ', async () => {
		const store = createInMemoryWebhookDeliveryStore();
		const errors: unknown[] = [];
		const dispatch = createWebhookDispatcher({
			deliveryStore: store,
			endpoints: [{ secret: SECRET, url: 'https://hooks.test/dead' }],
			fetch: recordingFetch([], false),
			retry: { attempts: 2, initialDelayMs: 1 },
			onDeliveryError: ({ error }) => {
				errors.push(error);
			},
			sleep: async () => undefined
		});

		await dispatch({ at: Date.now(), type: 'logout', userId: 'u9' });

		expect(errors).toHaveLength(1);
		const failed = await store.listFailed();
		expect(failed).toHaveLength(1);
		expect(failed[0]?.endpointUrl).toBe('https://hooks.test/dead');
		expect(failed[0]?.attempts).toBe(2);
		expect(failed[0]?.lastStatus).toBe(HTTP_SERVER_ERROR);
		expect(failed[0]?.envelope.type).toBe('logout');

		const envelopeId = failed[0]?.envelope.id;
		expect(envelopeId).toBeDefined();
		if (envelopeId !== undefined) {
			await store.removeFailure(envelopeId);
		}
		expect(await store.listFailed()).toHaveLength(0);
	});

	test('per-endpoint events filter skips non-matching event types', async () => {
		const loginsOnly: CapturedRequest[] = [];
		const everything: CapturedRequest[] = [];
		const dispatch = createWebhookDispatcher({
			endpoints: [
				{
					events: ['credentials_login'],
					secret: SECRET,
					url: 'https://hooks.test/logins'
				},
				{
					secret: SECRET,
					url: 'https://hooks.test/all'
				}
			],
			fetch: async (url, init) => {
				const target = url.endsWith('/logins')
					? loginsOnly
					: everything;
				target.push({
					body: init.body,
					headers: init.headers,
					url
				});

				return { ok: true, status: HTTP_OK };
			}
		});

		await dispatch({ at: Date.now(), type: 'credentials_login' });
		await dispatch({ at: Date.now(), type: 'logout' });

		expect(loginsOnly).toHaveLength(1);
		expect(JSON.parse(loginsOnly[0]?.body ?? '{}').data.type).toBe(
			'credentials_login'
		);
		expect(everything).toHaveLength(2);
	});
});

describe('webhooks wired into auth()', () => {
	test('forwards an auth event (register) to the configured endpoint', async () => {
		const captured: CapturedRequest[] = [];
		const credentialStore = createInMemoryCredentialStore();
		const users = new Map<string, TestUser>();
		const authInstance = await auth<TestUser>({
			authSessionStore: createInMemoryAuthSessionStore<TestUser>(),
			credentials: {
				credentialStore,
				passwordPolicy: { minLength: 8 },
				getUserByEmail: (email) => users.get(email) ?? null,
				onCreateCredentialUser: ({ email }) => {
					const user: TestUser = { email, sub: `user:${email}` };
					users.set(email, user);

					return user;
				},
				onSendEmail: () => undefined
			},
			providersConfiguration: {},
			webhooks: {
				endpoints: [{ secret: SECRET, url: 'https://hooks.test/auth' }],
				fetch: recordingFetch(captured)
			}
		});
		const app = new Elysia().use(authInstance);

		await app.handle(
			new Request('http://localhost/auth/register', {
				body: JSON.stringify({
					email: 'hook@example.com',
					password: 'supersecret'
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);

		const types = captured.map(
			(request) => JSON.parse(request.body).data.type
		);
		expect(types).toContain('register');
	});
});
