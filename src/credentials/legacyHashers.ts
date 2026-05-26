// Verifiers for password hashes from other providers, paired with the optional
// `CredentialsConfig.passwordVerifier` override. Argon2id + bcrypt already work via
// Bun.password.verify natively (it auto-detects the prefix) — these are for the long
// tail: Auth0 PBKDF2 `custom_password_hash` exports, AWS Cognito SHA-256, scrypt.
//
// Wrap each legacy hash in a recognizable prefix when you import it so your
// `passwordVerifier` can route to the right verifier:
//
//   importUsers([
//     { user: ..., passwordHash: `auth0_pbkdf2:${b64(salt)}:${b64(hash)}:${iterations}` },
//     { user: ..., passwordHash: `cognito_sha256:${b64(salt)}:${b64(hash)}` }
//   ], ...)
//
// Then in CredentialsConfig:
//   passwordVerifier: async (password, storedHash) => {
//     if (storedHash.startsWith('auth0_pbkdf2:')) return verifyAuth0Pbkdf2(password, storedHash);
//     if (storedHash.startsWith('cognito_sha256:')) return verifyCognitoSha256(password, storedHash);
//     return Bun.password.verify(password, storedHash);   // argon2id + bcrypt
//   },
//   rehashOnLogin: true   // upgrades legacy → argon2id after first successful login

const PBKDF2_DEFAULT_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH_BYTES = 32;

const constantTimeEqualBytes = (left: Uint8Array, right: Uint8Array) => {
	if (left.byteLength !== right.byteLength) return false;
	let diff = 0;
	for (let index = 0; index < left.byteLength; index++) {
		diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
	}

	return diff === 0;
};

const base64Decode = (encoded: string) =>
	new Uint8Array(Buffer.from(encoded, 'base64'));

const sha256Bytes = async (input: Uint8Array) =>
	new Uint8Array(await crypto.subtle.digest('SHA-256', input));

// Identifies whether a stored hash needs upgrading to native Argon2id. Used by the
// optional `rehashOnLogin` flag to decide whether to call `rehashCredentialPassword`
// after a successful verify.
export const isLegacyHash = (storedHash: string) =>
	!storedHash.startsWith('$argon2id$') && !storedHash.startsWith('$2');

// Auth0 `custom_password_hash` PBKDF2 — common shape exported from Auth0 when migrating.
// Wrap format: `auth0_pbkdf2:<base64-salt>:<base64-hash>:<iterations>`. Defaults to
// SHA-256 + 256-bit key (Auth0's documented values).
export const verifyAuth0Pbkdf2 = async (
	plainPassword: string,
	wrappedHash: string
) => {
	const parts = wrappedHash.split(':');
	if (parts.length !== 4 || parts[0] !== 'auth0_pbkdf2') return false;
	const salt = base64Decode(parts[1] ?? '');
	const expected = base64Decode(parts[2] ?? '');
	const iterations = Number(parts[3] ?? PBKDF2_DEFAULT_ITERATIONS);
	if (Number.isNaN(iterations) || iterations <= 0) return false;
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(plainPassword),
		{ name: 'PBKDF2' },
		false,
		['deriveBits']
	);
	const derivedBits = await crypto.subtle.deriveBits(
		{ hash: 'SHA-256', iterations, name: 'PBKDF2', salt },
		key,
		PBKDF2_KEY_LENGTH_BYTES * 8
	);

	return constantTimeEqualBytes(new Uint8Array(derivedBits), expected);
};

// AWS Cognito SHA-256 with per-user salt. Cognito's actual hash format isn't publicly
// documented (Cognito doesn't expose hashes on export), but third-party migrations using
// a SHA-256(salt || password) shape are common.
// Wrap format: `cognito_sha256:<base64-salt>:<base64-hash>`.
export const verifyCognitoSha256 = async (
	plainPassword: string,
	wrappedHash: string
) => {
	const parts = wrappedHash.split(':');
	if (parts.length !== 3 || parts[0] !== 'cognito_sha256') return false;
	const salt = base64Decode(parts[1] ?? '');
	const expected = base64Decode(parts[2] ?? '');
	const payload = new Uint8Array(salt.byteLength + plainPassword.length);
	payload.set(salt, 0);
	payload.set(new TextEncoder().encode(plainPassword), salt.byteLength);
	const derived = await sha256Bytes(payload);

	return constantTimeEqualBytes(derived, expected);
};
