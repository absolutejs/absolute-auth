import { describe, expect, test } from 'bun:test';
import {
	base32Decode,
	base32Encode,
	constantTimeEqual,
	createTotpKeyUri,
	decryptSecret,
	encryptSecret,
	generateEncryptionKey,
	generateSecureToken,
	generateTotp,
	generateTotpSecret,
	hashPassword,
	hashToken,
	verifyPassword,
	verifyTotp
} from '../src/crypto';

// RFC 4648 base32 of ASCII "12345678901234567890" — the canonical RFC TOTP key.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SECONDS = 1000;

describe('password hashing', () => {
	test('verifies a correct password and rejects a wrong one', async () => {
		const hash = await hashPassword('correct horse battery staple');

		expect(hash).not.toBe('correct horse battery staple');
		expect(await verifyPassword('correct horse battery staple', hash)).toBe(
			true
		);
		expect(await verifyPassword('wrong password', hash)).toBe(false);
	});
});

describe('secure tokens', () => {
	test('generates distinct url-safe tokens', () => {
		const first = generateSecureToken();
		const second = generateSecureToken();

		expect(first).not.toBe(second);
		expect(first).toMatch(/^[A-Za-z0-9_-]+$/u);
	});

	test('hashToken is deterministic and not the plaintext', async () => {
		const token = generateSecureToken();

		expect(await hashToken(token)).toBe(await hashToken(token));
		expect(await hashToken(token)).not.toBe(token);
	});
});

describe('constantTimeEqual', () => {
	test('matches equal strings and rejects different ones', async () => {
		expect(await constantTimeEqual('a-secret-token', 'a-secret-token')).toBe(
			true
		);
		expect(await constantTimeEqual('a-secret-token', 'a-secret-tokem')).toBe(
			false
		);
		expect(await constantTimeEqual('short', 'a-much-longer-value')).toBe(
			false
		);
	});
});

describe('base32', () => {
	test('encodes the RFC test key', () => {
		const bytes = new TextEncoder().encode('12345678901234567890');

		expect(base32Encode(bytes)).toBe(RFC_SECRET);
	});

	test('round-trips arbitrary bytes', () => {
		const bytes = new Uint8Array([0, 1, 127, 128, 255, 42, 17]);

		expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
	});
});

describe('TOTP (RFC 6238 vectors)', () => {
	const vectors: { code: string; time: number }[] = [
		{ code: '287082', time: 59 },
		{ code: '081804', time: 1111111109 },
		{ code: '050471', time: 1111111111 },
		{ code: '005924', time: 1234567890 },
		{ code: '279037', time: 2000000000 }
	];

	test('generates the expected 6-digit codes', async () => {
		const codes = await Promise.all(
			vectors.map((vector) =>
				generateTotp({ now: vector.time * SECONDS, secret: RFC_SECRET })
			)
		);

		expect(codes).toEqual(vectors.map((vector) => vector.code));
	});

	test('verifies a valid code and rejects an invalid one', async () => {
		expect(
			await verifyTotp({
				now: 59 * SECONDS,
				secret: RFC_SECRET,
				token: '287082',
				window: 0
			})
		).toBe(true);
		expect(
			await verifyTotp({
				now: 59 * SECONDS,
				secret: RFC_SECRET,
				token: '000000',
				window: 0
			})
		).toBe(false);
	});

	test('accepts a freshly generated secret + code within the window', async () => {
		const secret = generateTotpSecret();
		const code = await generateTotp({ secret });

		expect(await verifyTotp({ secret, token: code })).toBe(true);
	});

	test('builds an otpauth key URI', () => {
		const uri = createTotpKeyUri({
			accountName: 'user@example.com',
			issuer: 'AbsoluteAuth',
			secret: RFC_SECRET
		});

		expect(uri).toContain('otpauth://totp/');
		expect(uri).toContain(`secret=${RFC_SECRET}`);
		expect(uri).toContain('issuer=AbsoluteAuth');
	});
});

describe('AES-GCM secret encryption', () => {
	test('round-trips a secret and produces distinct ciphertexts', async () => {
		const key = generateEncryptionKey();
		const plaintext = 'totp-secret-or-provider-token';
		const first = await encryptSecret(plaintext, key);
		const second = await encryptSecret(plaintext, key);

		expect(first).not.toBe(second);
		expect(await decryptSecret(first, key)).toBe(plaintext);
		expect(await decryptSecret(second, key)).toBe(plaintext);
	});

	test('fails to decrypt with the wrong key', async () => {
		const ciphertext = await encryptSecret('secret', generateEncryptionKey());

		expect(decryptSecret(ciphertext, generateEncryptionKey())).rejects.toThrow();
	});
});
