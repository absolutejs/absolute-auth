import { afterEach, describe, expect, test } from 'bun:test';
import { createAuthClient } from '../src/client/createAuthClient';
import { installAuthClientRuntimeTransport } from '../src/client/runtimeTransport';

const cleanups: Array<() => void> = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe('Auth client runtime transport', () => {
	test('is consulted by unchanged createAuthClient calls', async () => {
		const requests: string[] = [];
		cleanups.push(
			installAuthClientRuntimeTransport({
				fetch: async (input) => {
					requests.push(String(input));

					return Response.json({ user: { id: 'native-user' } });
				}
			})
		);
		const client = createAuthClient();
		expect(await client.status()).toEqual({
			data: { user: { id: 'native-user' } },
			error: null
		});
		expect(requests).toEqual(['/oauth2/status']);
	});

	test('explicit transports win and uninstall restores the previous layer', async () => {
		const first = installAuthClientRuntimeTransport({
			status: async () => ({ user: 'runtime' })
		});
		cleanups.push(first);
		expect((await createAuthClient().status()).data).toEqual({
			user: 'runtime'
		});
		expect(
			(
				await createAuthClient({
					transport: { status: async () => ({ user: 'explicit' }) }
				}).status()
			).data
		).toEqual({ user: 'explicit' });
		first();
		expect((await createAuthClient().status()).error?.status).toBe(0);
	});
});
