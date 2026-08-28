import { describe, expect, test } from 'bun:test';
import { verifyDpopProof } from '../src/oidc/dpop';
import { generateSigningKey, toPublicJwk } from '../src/oidc/keys';

const HTU = 'https://resource.example.test/messages';

const buildProof = async ({
	headerJwk,
	htu = HTU,
	jti = crypto.randomUUID(),
	key
}: {
	headerJwk?: JsonWebKey;
	htu?: string;
	jti?: string | null;
	key: Awaited<ReturnType<typeof generateSigningKey>>;
}) => {
	const encode = (value: unknown) =>
		Buffer.from(JSON.stringify(value)).toString('base64url');
	const header = encode({
		alg: 'ES256',
		jwk: headerJwk ?? toPublicJwk(key),
		typ: 'dpop+jwt'
	});
	const payload = encode({
		htm: 'POST',
		htu,
		iat: Math.floor(Date.now() / 1000),
		...(jti === null ? {} : { jti })
	});
	if (!('privateJwk' in key)) throw new Error('Expected an exportable key');
	const signingKey = await crypto.subtle.importKey(
		'jwk',
		key.privateJwk,
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign(
		{ hash: 'SHA-256', name: 'ECDSA' },
		signingKey,
		new TextEncoder().encode(`${header}.${payload}`)
	);

	return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`;
};

describe('DPoP proof verification (RFC 9449)', () => {
	test('atomically consumes the required jti after validating the proof', async () => {
		const key = await generateSigningKey();
		const proof = await buildProof({ key });
		const consumed: string[] = [];
		const result = await verifyDpopProof({
			htm: 'POST',
			htu: HTU,
			proof,
			consumeJti: async ({ jti }) => {
				if (consumed.includes(jti)) return false;
				consumed.push(jti);

				return true;
			}
		});

		expect(result?.jti).toBe(consumed[0]);
		expect(
			await verifyDpopProof({
				htm: 'POST',
				htu: HTU,
				proof,
				consumeJti: async ({ jti }) => !consumed.includes(jti)
			})
		).toBeUndefined();
	});

	test('rejects missing and oversized jti claims', async () => {
		const key = await generateSigningKey();

		expect(
			await verifyDpopProof({
				htm: 'POST',
				htu: HTU,
				proof: await buildProof({ jti: null, key })
			})
		).toBeUndefined();
		expect(
			await verifyDpopProof({
				htm: 'POST',
				htu: HTU,
				proof: await buildProof({ jti: 'x'.repeat(129), key })
			})
		).toBeUndefined();
	});

	test('rejects query-bearing htu claims and private proof keys', async () => {
		const key = await generateSigningKey();
		if (!('privateJwk' in key)) throw new Error('Expected an exportable key');

		expect(
			await verifyDpopProof({
				htm: 'POST',
				htu: `${HTU}?page=1`,
				proof: await buildProof({ htu: `${HTU}?page=1`, key })
			})
		).toBeUndefined();
		expect(
			await verifyDpopProof({
				htm: 'POST',
				htu: HTU,
				proof: await buildProof({ headerJwk: key.privateJwk, key })
			})
		).toBeUndefined();
	});

	test('fails closed rather than throwing for malformed JOSE input', async () => {
		expect(
			await verifyDpopProof({
				htm: 'POST',
				htu: HTU,
				proof: 'not-json.payload.signature'
			})
		).toBeUndefined();
	});
});
