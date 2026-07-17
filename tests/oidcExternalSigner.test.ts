import { expect, test } from 'bun:test';
import {
	generateSigningKey,
	signJwt,
	verifyJwt,
	type SigningKey
} from '../src/oidc/keys';

test('signs OIDC tokens without exporting application signing material', async () => {
	const generated = await generateSigningKey();
	if (generated.privateJwk === undefined) {
		throw new Error('Generated test key has no private material');
	}
	const privateKey = await crypto.subtle.importKey(
		'jwk',
		generated.privateJwk,
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign']
	);
	let calls = 0;
	const external: SigningKey = {
		kid: generated.kid,
		publicJwk: generated.publicJwk,
		sign: async (input) => {
			calls += 1;

			return new Uint8Array(
				await crypto.subtle.sign(
					{ hash: 'SHA-256', name: 'ECDSA' },
					privateKey,
					input
				)
			);
		}
	};
	const token = await signJwt({ sub: 'member-1' }, external);
	const verified = await verifyJwt(token, external.publicJwk);

	expect(calls).toBe(1);
	expect(verified?.payload.sub).toBe('member-1');
	expect('privateJwk' in external).toBe(false);
});

test('rejects signatures that are not JOSE ES256 width', async () => {
	const generated = await generateSigningKey();
	const external: SigningKey = {
		kid: generated.kid,
		publicJwk: generated.publicJwk,
		sign: async () => new Uint8Array()
	};

	await expect(signJwt({ sub: 'member-1' }, external)).rejects.toThrow(
		'64-byte JOSE signature'
	);
});
