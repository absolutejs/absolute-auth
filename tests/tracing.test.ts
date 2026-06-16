import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	SimpleSpanProcessor
} from '@opentelemetry/sdk-trace-base';
import { Elysia } from 'elysia';
import type { CredentialsConfig } from '../src/credentials/config';
import { credentialsLogin } from '../src/credentials/login';
import { credentialsRegister } from '../src/credentials/register';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { signout } from '../src/routes/signout';
import {
	__resetTracingForTests,
	initTracing,
	withSpan
} from '../src/telemetry/tracing';

// Tracing is added 0.35.0-beta.0. These tests use OTel's BasicTracerProvider with an
// InMemorySpanExporter so the assertions can read the spans the package emits without
// hitting a real APM. Without `initTracing`, `withSpan` is a no-op + the existing
// non-tracing flows keep working (covered by every other test file). The "no tracer
// configured" assertion below also locks that in.

type TestUser = { email: string; sub: string };

const buildExporter = () => {
	const exporter = new InMemorySpanExporter();
	const provider = new BasicTracerProvider({
		spanProcessors: [new SimpleSpanProcessor(exporter)]
	});

	return { exporter, provider };
};

const buildApp = () => {
	const credentialStore = createInMemoryCredentialStore();
	const users = new Map<string, TestUser>();
	const config: CredentialsConfig<TestUser> = {
		credentialStore,
		passwordPolicy: { minLength: 8 },
		getUserByEmail: (email) => users.get(email) ?? null,
		onCreateCredentialUser: ({ email }) => {
			const user: TestUser = { email, sub: `user:${email}` };
			users.set(email, user);

			return user;
		},
		onSendEmail: () => undefined
	};

	return new Elysia()
		.use(credentialsRegister(config))
		.use(credentialsLogin(config))
		.use(signout<TestUser>({ onSignOut: undefined }));
};

const postJson = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	body: unknown
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		})
	);

describe('OpenTelemetry instrumentation', () => {
	afterEach(() => {
		__resetTracingForTests();
	});

	test('withSpan is a no-op when initTracing was never called', async () => {
		// Sanity: calling withSpan returns the work's value, no error, no provider needed.
		const result = await withSpan(
			'test.noop',
			{ foo: 'bar' },
			async () => 42
		);
		expect(result).toBe(42);
	});

	test('credentials login emits an auth.credentials.login span', async () => {
		const { exporter, provider } = buildExporter();
		await initTracing({ tracerProvider: provider });

		const app = buildApp();
		await postJson(app, '/auth/register', {
			email: 'a@b.com',
			password: 'supersecret'
		});
		exporter.reset();

		const loginResponse = await postJson(app, '/auth/login', {
			email: 'a@b.com',
			password: 'supersecret'
		});
		expect(loginResponse.status).toBe(200);

		const spans = exporter.getFinishedSpans();
		const loginSpan = spans.find(
			(span) => span.name === 'auth.credentials.login'
		);
		expect(loginSpan).toBeDefined();
		expect(loginSpan?.status.code).toBe(1); // SpanStatusCode.OK
	});

	test('credentials register emits an auth.credentials.register span', async () => {
		const { exporter, provider } = buildExporter();
		await initTracing({ tracerProvider: provider });

		const app = buildApp();
		const response = await postJson(app, '/auth/register', {
			email: 'b@c.com',
			password: 'supersecret'
		});
		expect(response.status).toBe(201);

		const spans = exporter.getFinishedSpans();
		expect(
			spans.some((span) => span.name === 'auth.credentials.register')
		).toBe(true);
	});

	test('signout emits an auth.signout span', async () => {
		const { exporter, provider } = buildExporter();
		await initTracing({ tracerProvider: provider });

		const app = buildApp();
		await postJson(app, '/auth/register', {
			email: 'c@d.com',
			password: 'supersecret'
		});
		const loginResponse = await postJson(app, '/auth/login', {
			email: 'c@d.com',
			password: 'supersecret'
		});
		const setCookie = loginResponse.headers.get('set-cookie') ?? '';
		const match = setCookie.match(/user_session_id=([^;]+)/);
		const cookie = `user_session_id=${match?.[1] ?? ''}`;
		exporter.reset();

		await app.handle(
			new Request('http://localhost/oauth2/signout', {
				headers: { cookie },
				method: 'DELETE'
			})
		);

		const spans = exporter.getFinishedSpans();
		expect(spans.some((span) => span.name === 'auth.signout')).toBe(true);
	});

	test('explicit withSpan call from consumer code is captured', async () => {
		const { exporter, provider } = buildExporter();
		await initTracing({ tracerProvider: provider });

		const result = await withSpan(
			'consumer.action',
			{ 'auth.flow': 'custom' },
			async (span) => {
				span?.setAttribute('extra', 'thing');

				return 'done';
			}
		);
		expect(result).toBe('done');

		const spans = exporter.getFinishedSpans();
		const consumerSpan = spans.find(
			(span) => span.name === 'consumer.action'
		);
		expect(consumerSpan).toBeDefined();
		expect(consumerSpan?.attributes['auth.flow']).toBe('custom');
		expect(consumerSpan?.attributes.extra).toBe('thing');
	});
});

describe('withSpan error path', () => {
	let exporter: InMemorySpanExporter;
	beforeEach(async () => {
		const { exporter: builtExporter, provider } = buildExporter();
		exporter = builtExporter;
		await initTracing({ tracerProvider: provider });
	});
	afterEach(() => {
		__resetTracingForTests();
	});

	test('a throwing work fn records the exception and marks the span ERROR', async () => {
		await expect(
			withSpan('boom', undefined, async () => {
				throw new Error('blew up');
			})
		).rejects.toThrow('blew up');

		const spans = exporter.getFinishedSpans();
		const boom = spans.find((span) => span.name === 'boom');
		expect(boom).toBeDefined();
		expect(boom?.status.code).toBe(2); // SpanStatusCode.ERROR
		expect(boom?.events.some((event) => event.name === 'exception')).toBe(
			true
		);
	});
});
