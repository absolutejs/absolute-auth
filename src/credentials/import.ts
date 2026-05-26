// Bulk user import from another auth provider (Auth0 / WorkOS / Cognito / Firebase / etc.).
//
// The lean part is the orchestration: take a list of `{email, passwordHash, ...}` records,
// call the consumer's `onCreateUser` to write the user row, then stash the credential. Bun
// natively verifies argon2id AND bcrypt hashes via `Bun.password.verify` — which covers
// ~90% of real-world imports (Auth0 bcrypt export, WorkOS bcrypt, anything that hashes
// with bcrypt). For those: just pass the hash string through unchanged + done.
//
// The long tail (Auth0 PBKDF2 `custom_password_hash`, Cognito SHA-256, legacy scrypt) needs
// a `passwordVerifier` override in `CredentialsConfig` — see `legacyHashers.ts` for the
// verify helpers that pair with this importer.

import { hashPassword } from '../crypto';
import type { CredentialRecord, CredentialStore } from './types';

export type ImportableUser<UserType> = {
	// Optional pre-hashed password. Argon2id (`$argon2id$…`) and bcrypt (`$2[aby]$…`)
	// flow through verifyPassword natively. Other algorithms need a custom
	// `passwordVerifier` in CredentialsConfig + a wrapping format (e.g. `auth0_pbkdf2:...`).
	// Omit to create a no-password (OAuth-only) record.
	passwordHash?: string;
	// Whatever shape the consumer's `onCreateUser` expects — opaque to us.
	user: UserType;
};

export type ImportUserResult<UserType> =
	| { error: string; ok: false; user: UserType }
	| { credential?: CredentialRecord; ok: true; user: UserType };

export type ImportUsersOptions<UserType> = {
	// Called once per user — consumer's job to insert their user row. Should return the
	// stable string id the credential gets keyed by (usually the email after normalization).
	// Throwing or returning `null` skips the credential write + records an error in the
	// per-user result so the caller can react without aborting the whole batch.
	onCreateUser: (input: ImportableUser<UserType>) => Promise<
		| {
				email: string;
				emailVerified?: boolean;
				userId?: string;
		  }
		| null
	>;
	// Optional concurrency cap. Defaults to 1 (sequential) because most consumer
	// `onCreateUser` hooks hit a single DB connection — parallel writes don't help and
	// risk write conflicts. Bump for high-throughput stores that handle parallelism.
	concurrency?: number;
	credentialStore: CredentialStore;
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

// Default-empty `password_hash` import: write the credential row with the hash unchanged
// (so Bun.password.verify reads it as-is on login). Argon2id + bcrypt prefixes flow
// natively; everything else relies on the consumer's `passwordVerifier` override.
const buildCredential = (
	email: string,
	emailVerified: boolean,
	passwordHash: string,
	userId?: string
): CredentialRecord => ({
	createdAt: Date.now(),
	email,
	emailVerified,
	passwordHash,
	status: 'active',
	updatedAt: Date.now(),
	userId
});

// Import one user record. Exported so a consumer can do its own batching/streaming
// (e.g. reading a multi-GB Auth0 export line-by-line). Explicit return type because
// the inferred type widens `ok: true | false` to `ok: boolean`, which breaks the
// discriminated union narrowing on the caller side.
export const importUser = async <UserType>(
	input: ImportableUser<UserType>,
	options: ImportUsersOptions<UserType>
	// eslint-disable-next-line absolute/no-explicit-return-type -- ImportUserResult discriminant must stay narrow; inference widens `ok: true | false` to `boolean`
): Promise<ImportUserResult<UserType>> => {
	try {
		const created = await options.onCreateUser(input);
		if (created === null)
			return {
				error: 'onCreateUser returned null',
				ok: false,
				user: input.user
			};
		const email = normalizeEmail(created.email);
		const emailVerified = created.emailVerified ?? true;
		if (input.passwordHash === undefined) {
			return { ok: true, user: input.user };
		}
		const credential = buildCredential(
			email,
			emailVerified,
			input.passwordHash,
			created.userId
		);
		await options.credentialStore.saveCredential(credential);

		return { credential, ok: true, user: input.user };
	} catch (err) {
		return {
			error: err instanceof Error ? err.message : String(err),
			ok: false,
			user: input.user
		};
	}
};

// Batch helper: walks the input list with the configured concurrency, returns per-user
// results so the caller can summarize success/failure without aborting on the first error.
export const importUsers = async <UserType>(
	inputs: readonly ImportableUser<UserType>[],
	options: ImportUsersOptions<UserType>
) => {
	const concurrency = Math.max(1, options.concurrency ?? 1);
	const results: ImportUserResult<UserType>[] = [];
	for (let cursor = 0; cursor < inputs.length; cursor += concurrency) {
		const slice = inputs.slice(cursor, cursor + concurrency);
		// eslint-disable-next-line no-await-in-loop -- batched-sequential by design (see `concurrency` doc)
		const batch = await Promise.all(
			slice.map((input) => importUser(input, options))
		);
		results.push(...batch);
	}

	return {
		failed: results.filter((result): result is Extract<typeof result, { ok: false }> => !result.ok).length,
		results,
		succeeded: results.filter((result) => result.ok).length
	};
};

// Re-hash + save a plaintext password as Argon2id. Called after a successful login
// against a legacy hash to upgrade the stored hash in place — pair with `passwordVerifier`.
export const rehashCredentialPassword = async ({
	credentialStore,
	current,
	plainPassword
}: {
	credentialStore: CredentialStore;
	current: CredentialRecord;
	plainPassword: string;
}) => {
	const passwordHash = await hashPassword(plainPassword);
	await credentialStore.saveCredential({
		...current,
		passwordHash,
		updatedAt: Date.now()
	});
};
