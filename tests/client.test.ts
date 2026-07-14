import { describe, expect, mock, test } from 'bun:test';
import { createAuthClient } from '../src/client/createAuthClient';

const stub = (
	handler: (url: string, init: RequestInit) => Response | Promise<Response>
) =>
	mock(
		async (input: RequestInfo | URL, init?: RequestInit) =>
			handler(input.toString(), init ?? {})
		// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test stub for fetch
	) as unknown as typeof fetch;

describe('createAuthClient', () => {
	test('signIn.email posts JSON and unwraps the body on 200', async () => {
		const calls: { body?: unknown; url: string }[] = [];
		const client = createAuthClient({
			fetch: stub((url, init) => {
				calls.push({
					body: init.body
						? JSON.parse(init.body.toString())
						: undefined,
					url
				});

				return new Response(
					JSON.stringify({ status: 'authenticated' })
				);
			})
		});

		const { data, error } = await client.signIn.email({
			email: 'alice@acme.test',
			password: 'pw'
		});

		expect(error).toBeNull();
		expect(data).toEqual({ status: 'authenticated' });
		expect(calls[0]?.url).toBe('/auth/login');
		expect(calls[0]?.body).toEqual({
			email: 'alice@acme.test',
			password: 'pw'
		});
	});

	test('a non-2xx response yields {data: null, error: {...}}', async () => {
		const client = createAuthClient({
			fetch: stub(
				() => new Response('Invalid email or password', { status: 401 })
			)
		});

		const result = await client.signIn.email({ email: 'x', password: 'y' });
		expect(result.data).toBeNull();
		expect(result.error?.status).toBe(401);
		expect(result.error?.message).toBe('Invalid email or password');
	});

	test('a network error yields status:0', async () => {
		const client = createAuthClient({
			fetch: stub(() => {
				throw new Error('boom');
			})
		});

		const result = await client.signOut();
		expect(result.error?.status).toBe(0);
		expect(result.error?.message).toBe('boom');
	});

	test('routes overrides change the URL the client posts to', async () => {
		const calls: string[] = [];
		const client = createAuthClient({
			fetch: stub((url) => {
				calls.push(url);

				return new Response('null');
			}),
			routes: { login: '/api/v2/login' }
		});

		await client.signIn.email({ email: 'a', password: 'b' });
		expect(calls[0]).toBe('/api/v2/login');
	});

	test('baseUrl prefixes every request', async () => {
		const calls: string[] = [];
		const client = createAuthClient({
			baseUrl: 'https://idp.example',
			fetch: stub((url) => {
				calls.push(url);

				return new Response('null');
			})
		});

		await client.signIn.email({ email: 'a', password: 'b' });
		expect(calls[0]).toBe('https://idp.example/auth/login');
	});

	test('mfa status and disable use the management endpoint', async () => {
		const calls: { method?: string; url: string }[] = [];
		const client = createAuthClient({
			fetch: stub((url, init) => {
				calls.push({ method: init.method, url });

				return new Response('{}');
			})
		});

		await client.mfa.status();
		await client.mfa.disable();
		expect(calls).toEqual([
			{ method: 'GET', url: '/auth/mfa' },
			{ method: 'DELETE', url: '/auth/mfa' }
		]);
	});

	test('passkeys.remove URL-encodes the credential id', async () => {
		const calls: { method?: string; url: string }[] = [];
		const client = createAuthClient({
			fetch: stub((url, init) => {
				calls.push({ method: init.method, url });

				return new Response(JSON.stringify({ ok: true }));
			})
		});

		await client.passkeys.remove('cred/with slash');
		expect(calls[0]?.method).toBe('DELETE');
		expect(calls[0]?.url).toBe(
			'/auth/webauthn/credentials/cred%2Fwith%20slash'
		);
	});
});
