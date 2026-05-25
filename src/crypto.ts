import { MILLISECONDS_IN_A_SECOND } from './constants';

// All primitives here are dependency-free: Bun.password for hashing and
// WebCrypto for everything else (HMAC, SHA-256, AES-GCM, secure random).

const DEFAULT_TOKEN_BYTES = 32;
const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 12;

const HOTP_COUNTER_BYTES = 8;
const TOTP_SECRET_BYTES = 20;
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const DEFAULT_TOTP_WINDOW = 1;
const DECIMAL_RADIX = 10;
const LAST_NIBBLE_MASK = 0x0f;
const SIGN_BIT_MASK = 0x7fffffff;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32_GROUP_BITS = 5;
const BASE32_MASK = 0x1f;
const BYTE_BITS = 8;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const base64UrlEncode = (bytes: Uint8Array) =>
	Buffer.from(bytes).toString('base64url');

const base64UrlDecode = (encoded: string) =>
	new Uint8Array(Buffer.from(encoded, 'base64url'));

const sha256 = async (input: string) => {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		textEncoder.encode(input)
	);

	return new Uint8Array(digest);
};

const hmacSha1 = async (key: Uint8Array, message: Uint8Array) => {
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		key,
		{ hash: 'SHA-1', name: 'HMAC' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);

	return new Uint8Array(signature);
};

const counterToBytes = (counter: number) => {
	const bytes = new Uint8Array(HOTP_COUNTER_BYTES);
	new DataView(bytes.buffer).setBigUint64(0, BigInt(counter), false);

	return bytes;
};

const generateHotp = async (
	secret: Uint8Array,
	counter: number,
	digits = TOTP_DIGITS
) => {
	const hmac = await hmacSha1(secret, counterToBytes(counter));
	const view = new DataView(hmac.buffer, hmac.byteOffset, hmac.byteLength);
	const offset = view.getUint8(hmac.byteLength - 1) & LAST_NIBBLE_MASK;
	const truncated = view.getUint32(offset, false) & SIGN_BIT_MASK;
	const otp = truncated % DECIMAL_RADIX ** digits;

	return otp.toString().padStart(digits, '0');
};

const importAesKey = (keyMaterial: string) =>
	crypto.subtle.importKey(
		'raw',
		base64UrlDecode(keyMaterial),
		{ name: 'AES-GCM' },
		false,
		['decrypt', 'encrypt']
	);

export const base32Decode = (encoded: string) => {
	const normalized = encoded.toUpperCase().replace(/[^A-Z2-7]/gu, '');
	const bits = [...normalized]
		.map((char) =>
			BASE32_ALPHABET.indexOf(char)
				.toString(2)
				.padStart(BASE32_GROUP_BITS, '0')
		)
		.join('');
	const byteChunks = bits.match(/.{8}/gu) ?? [];

	return new Uint8Array(byteChunks.map((chunk) => parseInt(chunk, 2)));
};
export const base32Encode = (bytes: Uint8Array) => {
	const bits = Array.from(bytes, (byte) =>
		byte.toString(2).padStart(BYTE_BITS, '0')
	).join('');
	const groups = bits.match(/.{1,5}/gu) ?? [];

	return groups
		.map(
			(group) =>
				BASE32_ALPHABET[
					parseInt(group.padEnd(BASE32_GROUP_BITS, '0'), 2) &
						BASE32_MASK
				] ?? ''
		)
		.join('');
};
export const constantTimeEqual = async (left: string, right: string) => {
	const [leftDigest, rightDigest] = await Promise.all([
		sha256(left),
		sha256(right)
	]);
	const leftView = new DataView(
		leftDigest.buffer,
		leftDigest.byteOffset,
		leftDigest.byteLength
	);
	const rightView = new DataView(
		rightDigest.buffer,
		rightDigest.byteOffset,
		rightDigest.byteLength
	);
	let mismatch = 0;
	for (let index = 0; index < leftDigest.byteLength; index += 1) {
		mismatch |= leftView.getUint8(index) ^ rightView.getUint8(index);
	}

	return mismatch === 0;
};
export const createTotpKeyUri = ({
	accountName,
	digits = TOTP_DIGITS,
	issuer,
	period = TOTP_PERIOD_SECONDS,
	secret
}: {
	accountName: string;
	digits?: number;
	issuer: string;
	period?: number;
	secret: string;
}) => {
	const params = new URLSearchParams({
		algorithm: 'SHA1',
		digits: `${digits}`,
		issuer,
		period: `${period}`,
		secret
	});
	const label = encodeURIComponent(`${issuer}:${accountName}`);

	return `otpauth://totp/${label}?${params.toString()}`;
};
export const decryptSecret = async (
	ciphertext: string,
	keyMaterial: string
) => {
	const key = await importAesKey(keyMaterial);
	const combined = base64UrlDecode(ciphertext);
	const nonce = combined.subarray(0, AES_IV_BYTES);
	const data = combined.subarray(AES_IV_BYTES);
	const plaintext = await crypto.subtle.decrypt(
		{ iv: nonce, name: 'AES-GCM' },
		key,
		data
	);

	return textDecoder.decode(plaintext);
};
export const encryptSecret = async (plaintext: string, keyMaterial: string) => {
	const key = await importAesKey(keyMaterial);
	const nonce = new Uint8Array(AES_IV_BYTES);
	crypto.getRandomValues(nonce);
	const ciphertext = await crypto.subtle.encrypt(
		{ iv: nonce, name: 'AES-GCM' },
		key,
		textEncoder.encode(plaintext)
	);
	const combined = new Uint8Array(nonce.byteLength + ciphertext.byteLength);
	combined.set(nonce, 0);
	combined.set(new Uint8Array(ciphertext), nonce.byteLength);

	return base64UrlEncode(combined);
};
export const generateEncryptionKey = () => generateSecureToken(AES_KEY_BYTES);
export const generateSecureToken = (byteLength = DEFAULT_TOKEN_BYTES) => {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);

	return base64UrlEncode(bytes);
};
export const generateTotp = async ({
	digits = TOTP_DIGITS,
	now = Date.now(),
	period = TOTP_PERIOD_SECONDS,
	secret
}: {
	digits?: number;
	now?: number;
	period?: number;
	secret: string;
}) => {
	const counter = Math.floor(now / MILLISECONDS_IN_A_SECOND / period);

	return generateHotp(base32Decode(secret), counter, digits);
};
export const generateTotpSecret = (byteLength = TOTP_SECRET_BYTES) => {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);

	return base32Encode(bytes);
};
export const hashPassword = (password: string) =>
	Bun.password.hash(password, { algorithm: 'argon2id' });
export const hashToken = async (token: string) =>
	base64UrlEncode(await sha256(token));
export const verifyPassword = (password: string, hash: string) =>
	Bun.password.verify(password, hash);
export const verifyTotp = async ({
	digits = TOTP_DIGITS,
	now = Date.now(),
	period = TOTP_PERIOD_SECONDS,
	secret,
	token,
	window = DEFAULT_TOTP_WINDOW
}: {
	digits?: number;
	now?: number;
	period?: number;
	secret: string;
	token: string;
	window?: number;
}) => {
	const secretBytes = base32Decode(secret);
	const counter = Math.floor(now / MILLISECONDS_IN_A_SECOND / period);
	const drifts = Array.from(
		{ length: window * 2 + 1 },
		(_, offset) => counter - window + offset
	);
	const candidates = await Promise.all(
		drifts.map((value) => generateHotp(secretBytes, value, digits))
	);
	const matches = await Promise.all(
		candidates.map((candidate) => constantTimeEqual(candidate, token))
	);

	return matches.includes(true);
};
