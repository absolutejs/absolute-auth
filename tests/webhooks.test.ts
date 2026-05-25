import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { auth } from '../src/index';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { createWebhookDispatcher } from '../src/webhooks/dispatcher';
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
