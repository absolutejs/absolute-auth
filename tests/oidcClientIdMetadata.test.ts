import { describe, expect, test } from 'bun:test';
import {
	createClientIdMetadataResolver,
	validateClientIdMetadataDocument
} from '../src/oidc/clientIdMetadata';

const clientId = 'https://agent.example/oauth-client.json';
const document = {
	client_id: clientId,
	client_name: 'Example Agent',
	redirect_uris: ['https://agent.example/callback'],
	scope: 'agent.read agent.write',
	token_endpoint_auth_method: 'none' as const
};

describe('OAuth Client ID Metadata Documents', () => {
	test('requires exact URL identity and secure redirect URIs', () => {
		expect(validateClientIdMetadataDocument(document, clientId)).toEqual(
			[]
		);
		expect(
			validateClientIdMetadataDocument(
				{
					...document,
					client_id: 'https://impostor.example/client.json'
				},
				clientId
			)
		).toContain('client_id does not match the metadata document URL');
	});

	test('resolves and caches a bounded no-redirect document', async () => {
		let calls = 0;
		const resolve = createClientIdMetadataResolver({
			fetch: async (_input, init) => {
				calls += 1;
				expect(init?.redirect).toBe('error');

				return new Response(JSON.stringify(document));
			}
		});
		expect((await resolve(clientId))?.clientId).toBe(clientId);
		expect((await resolve(clientId))?.scopes).toEqual([
			'agent.read',
			'agent.write'
		]);
		expect(calls).toBe(1);
	});

	test('rejects oversized metadata', async () => {
		const resolve = createClientIdMetadataResolver({
			fetch: async () =>
				new Response(JSON.stringify(document), {
					headers: { 'content-length': '6000' }
				})
		});
		expect(await resolve(clientId)).toBeUndefined();
	});
});
