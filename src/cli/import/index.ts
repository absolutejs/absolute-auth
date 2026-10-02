// Dispatcher for the `import` subcommand. Picks the right per-source
// parser (`auth0` / `clerk` / `supabase` / `lucia` / `nextauth`), runs
// it against the export file, and writes the resulting users +
// identities into the @absolutejs/auth schema via Postgres.
//
// One subcommand entry point, one dispatch table, one writer. Adding a
// new source means: drop a `<source>.ts` parser that returns
// `ImportResult`, register it here, done.

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

export type AuthImportWriter = (
	result: ImportResult,
	context: { databaseUrl: string }
) => Promise<{ userCount: number; identityCount: number }>;

export type ImportOptions = {
	commit: boolean;
	databaseUrl: string;
	/** Application adapter must transact user/credential/identity writes and retain stable IDs. */
	writer?: AuthImportWriter;
};

export const runImport = async (
	result: ImportResult,
	options: ImportOptions
) => {
	const ids = new Set<string>();
	const emails = new Set<string>();
	for (const user of result.users) {
		if (ids.has(user.externalId))
			throw new Error('Duplicate source user ID');
		ids.add(user.externalId);
		const email = user.email.trim().toLowerCase();
		if (emails.has(email))
			throw new Error(
				'Normalized email collision: resolve accounts explicitly before importing'
			);
		emails.add(email);
	}
	const pairs = new Set<string>();
	for (const identity of result.identities) {
		if (!ids.has(identity.userExternalId))
			throw new Error('Identity references an unknown source user');
		const pair = JSON.stringify([
			identity.authProvider,
			identity.providerSubject
		]);
		if (pairs.has(pair)) throw new Error('Duplicate provider identity');
		pairs.add(pair);
	}
	if (!options.commit)
		return {
			identityCount: result.identities.length,
			userCount: result.users.length
		};
	if (!options.writer)
		throw new Error(
			'Committed imports require --writer: an application adapter that preserves canonical user IDs and atomically writes users, auth_credentials and identities. Auth does not own your users schema.'
		);

	return options.writer(result, { databaseUrl: options.databaseUrl });
};
