// Dispatcher for the `import` subcommand. Picks the right per-source
// parser (`auth0` / `clerk` / `supabase` / `lucia` / `nextauth`), runs
// it against the export file, and writes the resulting users +
// identities into the @absolutejs/auth schema via Postgres.
//
// One subcommand entry point, one dispatch table, one writer. Adding a
// new source means: drop a `<source>.ts` parser that returns
// `ImportResult`, register it here, done.

import { neon } from '@neondatabase/serverless';
import { auth0Importer } from './auth0';
import { clerkImporter } from './clerk';
import { luciaImporter } from './lucia';
import { nextauthImporter } from './nextauth';
import { supabaseImporter } from './supabase';
import type { ImportResult, Importer } from './types';

export const importers: Record<string, Importer> = {
	auth0: auth0Importer,
	clerk: clerkImporter,
	lucia: luciaImporter,
	nextauth: nextauthImporter,
	supabase: supabaseImporter
};

export type ImportOptions = {
	commit: boolean;
	databaseUrl: string;
};

// Write the parsed records into the DB. Pre-flight by checking the
// `users` + `auth_identities` tables exist (the consumer should have
// run `bunx absolute-auth migrate` first). The writer assigns a fresh
// UUID `sub` to each imported user — we don't reuse the source's
// primary key as our `sub`, because most sources hand out short opaque
// strings that aren't UUIDs.
export const runImport = async (
	result: ImportResult,
	options: ImportOptions
) => {
	const sql = neon(options.databaseUrl);

	// Map source externalId → fresh UUID sub so we can link identities
	// after the user inserts land.
	const subByExternalId = new Map<string, string>();
	for (const user of result.users) {
		subByExternalId.set(user.externalId, crypto.randomUUID());
	}

	if (!options.commit) {
		// Dry run: just summarise.
		return {
			identityCount: result.identities.length,
			userCount: result.users.length
		};
	}

	// Real run: insert users one at a time (per-source uniqueness keys
	// vary; INSERT ... ON CONFLICT DO NOTHING on email keeps the writer
	// idempotent for repeated runs).
	for (const user of result.users) {
		const sub = subByExternalId.get(user.externalId);
		await sql`
			INSERT INTO users (sub, email, password, family_name, given_name, email_verified, created_at)
			VALUES (
				${sub},
				${user.email.toLowerCase().trim()},
				${user.passwordHash ?? null},
				${user.familyName ?? null},
				${user.givenName ?? null},
				${user.emailVerified},
				to_timestamp(${user.createdAtMs} / 1000.0)
			)
			ON CONFLICT (email) DO NOTHING
		`;
	}

	// Insert identities. Skip rows whose source user we didn't insert
	// (e.g. email-collision dedupe). The lookup goes through email
	// because `subByExternalId` is in-process — we need to resolve the
	// canonical sub from whatever's in the DB now.
	let insertedIdentities = 0;
	for (const identity of result.identities) {
		const sub = subByExternalId.get(identity.userExternalId);
		if (sub === undefined) continue;
		const inserted = await sql`
			INSERT INTO auth_identities (id, auth_provider, provider_subject, user_sub, metadata)
			VALUES (
				${`${identity.authProvider}:${identity.providerSubject}`},
				${identity.authProvider},
				${identity.providerSubject},
				${sub},
				${identity.metadata ?? {}}
			)
			ON CONFLICT (auth_provider, provider_subject) DO NOTHING
			RETURNING id
		`;
		if (Array.isArray(inserted) && inserted.length > 0)
			insertedIdentities++;
	}

	return {
		identityCount: insertedIdentities,
		userCount: result.users.length
	};
};
