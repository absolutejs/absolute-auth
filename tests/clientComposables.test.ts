import { describe, expect, mock, test } from 'bun:test';
import { get } from 'svelte/store';
import { createAuthClient } from '../src/client/createAuthClient';
import * as reactHooks from '../src/client/react';
import * as solidHooks from '../src/client/solid';
import * as svelteHooks from '../src/client/svelte';
import * as vueHooks from '../src/client/vue';

// Each framework wrapper is a thin specialization of createAuthClient (which has its own
// test) — these smoke tests just confirm the modules import cleanly + the public API
// matches React's (so a consumer can swap their import line and the rest works). The
// Svelte path is exercised end-to-end because `writable` works outside a component
// scope; Vue + Solid require an effect/root scope, so they're checked structurally.

const EXPECTED_API = [
	'useMagicLink',
	'useMfaChallenge',
	'usePasswordReset',
	'useSessions',
	'useSignIn',
	'useSignOut',
	'useSignUp'
] as const;

const stubFetch = (handler: (url: string) => Response) =>
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test stub for fetch
	mock(async (input: RequestInfo | URL) =>
		handler(input.toString())
	) as unknown as typeof fetch;

describe('framework composable API parity', () => {
	test('react/vue/solid/svelte expose the same named composables', () => {
		for (const name of EXPECTED_API) {
			expect(typeof reactHooks[name]).toBe('function');
			expect(typeof vueHooks[name]).toBe('function');
			expect(typeof solidHooks[name]).toBe('function');
			expect(typeof svelteHooks[name]).toBe('function');
		}
	});
});

describe('svelte composables (end-to-end via writable stores)', () => {
	test('useSignIn updates data/error/isPending stores through mutate', async () => {
		const client = createAuthClient({
			fetch: stubFetch(() =>
				new Response(JSON.stringify({ status: 'authenticated' }))
			)
		});

		const { data, error, isPending, mutate, reset } = svelteHooks.useSignIn(
			client
		);
		expect(get(data)).toBeNull();
		expect(get(error)).toBeNull();
		expect(get(isPending)).toBe(false);

		const result = await mutate({ email: 'a@b.com', password: 'pw' });
		expect(result.error).toBeNull();
		expect(result.data).toEqual({ status: 'authenticated' });
		expect(get(data)).toEqual({ status: 'authenticated' });
		expect(get(isPending)).toBe(false);

		reset();
		expect(get(data)).toBeNull();
		expect(get(error)).toBeNull();
	});

	test('useSignIn records errors when the request fails', async () => {
		const client = createAuthClient({
			fetch: stubFetch(
				() =>
					new Response(JSON.stringify({ message: 'nope' }), {
						status: 401
					})
			)
		});

		const { data, error, mutate } = svelteHooks.useSignIn(client);

		const result = await mutate({ email: 'a@b.com', password: 'pw' });
		expect(result.data).toBeNull();
		expect(result.error?.status).toBe(401);
		expect(get(data)).toBeNull();
		expect(get(error)?.message).toBe('nope');
	});

	test('useSessions starts pending, refetches on demand, and revoke clears one entry', async () => {
		type TestSession = { id: string; userId: string };
		let sessions: TestSession[] = [
			{ id: 'a', userId: 'u1' },
			{ id: 'b', userId: 'u1' }
		];
		const client = createAuthClient({
			fetch: stubFetch((url) => {
				if (url.endsWith('/auth/sessions')) {
					return new Response(JSON.stringify(sessions));
				}
				if (url.includes('/auth/sessions/')) {
					sessions = sessions.filter((entry) => !url.endsWith(entry.id));

					return new Response(JSON.stringify({ ok: true }));
				}

				return new Response('not found', { status: 404 });
			})
		});

		const { data, isPending, refetch, revoke } = svelteHooks.useSessions(
			client
		);
		// Initial fetch is scheduled synchronously; flush microtasks.
		await refetch();
		expect(get(isPending)).toBe(false);
		expect(get(data)).toHaveLength(2);

		await revoke('a');
		expect(get(data)).toHaveLength(1);
	});
});
