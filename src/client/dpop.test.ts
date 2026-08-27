import { describe, expect, test } from 'bun:test';
import { verifyDpopProof } from '../oidc/dpop';
import { createDpopClient, createDpopKey, createDpopProof } from './dpop';

const decodePayload = (proof: string) => {
	const [, payload] = proof.split('.');
	if (!payload) throw new Error('DPoP proof payload is missing');
	const value: unknown = JSON.parse(
		Buffer.from(payload, 'base64url').toString('utf8')
	);
	if (typeof value !== 'object' || value === null)
		throw new Error('DPoP proof payload is invalid');

	return value;
};

const payloadField = (proof: string, field: string) =>
	Reflect.get(decodePayload(proof), field);

describe('DPoP client', () => {
	test('creates a non-exportable ES256 proof key and verifiable proofs', async () => {
		const key = await createDpopKey();
		expect(key.privateKey.extractable).toBe(false);
		expect(key.publicJwk.d).toBeUndefined();
		const now = 1_000_000;
		const proof = await createDpopProof({
			accessToken: 'bound-access-token',
			htm: 'post',
			htu: 'https://api.example/inbox?ignored=true#fragment',
			jti: 'proof-1',
			key,
			now
		});

		expect(
			await verifyDpopProof({
				accessToken: 'bound-access-token',
				htm: 'POST',
				htu: 'https://api.example/inbox',
				now,
				proof
			})
		).toMatchObject({ jti: 'proof-1' });
	});

	test('retries one nonce challenge with a fresh proof and replayable body', async () => {
		const requests: Request[] = [];
		const bodies: string[] = [];
		const client = await createDpopClient({
			fetch: async (input, init) => {
				const request = new Request(input, init);
				const captured = request.clone();
				requests.push(captured);
				bodies.push(await request.text());

				return requests.length === 1
					? new Response(
							JSON.stringify({ error: 'use_dpop_nonce' }),
							{
								headers: { 'DPoP-Nonce': 'resource-nonce-1' },
								status: 401
							}
						)
					: new Response(JSON.stringify({ ok: true }));
			}
		});
		const response = await client.fetch(
			'https://api.example/inbox?cursor=private',
			{
				body: JSON.stringify({ maximumMessages: 1 }),
				dpop: {
					accessToken: 'bound-access-token',
					nonceScope: 'https://api.example/federation-inbox'
				},
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			}
		);

		expect(response.ok).toBe(true);
		expect(bodies).toEqual([
			'{"maximumMessages":1}',
			'{"maximumMessages":1}'
		]);
		expect(requests).toHaveLength(2);
		const firstProof = requests[0]?.headers.get('dpop');
		const secondProof = requests[1]?.headers.get('dpop');
		if (!firstProof || !secondProof)
			throw new Error('DPoP proof is missing');
		expect(requests[1]?.headers.get('authorization')).toBe(
			'DPoP bound-access-token'
		);
		expect(requests[1]?.redirect).toBe('manual');
		expect(payloadField(firstProof, 'nonce')).toBeUndefined();
		expect(payloadField(secondProof, 'nonce')).toBe('resource-nonce-1');
		expect(payloadField(firstProof, 'jti')).not.toBe(
			payloadField(secondProof, 'jti')
		);
		expect(decodePayload(secondProof)).toMatchObject({
			htm: 'POST',
			htu: 'https://api.example/inbox'
		});
	});
});
