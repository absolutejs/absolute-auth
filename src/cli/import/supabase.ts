// Supabase Auth importer.
//
// Supabase stores auth state in the `auth.users` + `auth.identities`
// tables of your Postgres. Easiest path: dump the two tables to JSON
// via `psql -c "COPY (SELECT row_to_json(t) FROM auth.users t) TO ..."`,
// then concatenate the two files into one JSON document:
//
//   {
//     "users": [
//       { "id": "...", "email": "alice@x", "encrypted_password": "$2a$10$...",
//         "email_confirmed_at": "2024-01-01T...", "created_at": "...",
//         "raw_user_meta_data": { "full_name": "Alice Smith" } },
//       …
//     ],
//     "identities": [
//       { "user_id": "...", "provider": "google", "provider_id": "118392...",
//         "identity_data": {...}, "created_at": "..." }
//     ]
//   }
//
// Supabase uses bcrypt for the `encrypted_password` column; verbatim copy
// works (and our credentials block sniffs the $2 prefix at next login).

import { readFile } from 'node:fs/promises';
import type { ImportResult, Importer } from './types';

type SupabaseUser = {
	created_at?: string;
	email: string;
	email_confirmed_at?: string;
	encrypted_password?: string;
	id: string;
	raw_user_meta_data?: { family_name?: string; full_name?: string; given_name?: string };
};

type SupabaseIdentity = {
	created_at?: string;
	provider: string;
	provider_id: string;
	user_id: string;
};

type SupabaseExport = {
	identities?: SupabaseIdentity[];
	users: SupabaseUser[];
};

const splitFullName = (full: string | undefined) => {
	if (full === undefined) return { familyName: undefined, givenName: undefined };
	const parts = full.split(/\s+/);
	if (parts.length === 1) return { familyName: undefined, givenName: parts[0] };

	return {
		familyName: parts.slice(1).join(' '),
		givenName: parts[0]
	};
};

export const supabaseImporter: Importer = {
	source: 'supabase',
	parse: async (path: string): Promise<ImportResult> => {
		const text = await readFile(path, 'utf-8');
		const parsed: SupabaseExport = JSON.parse(text);

		const users = parsed.users.map((raw) => {
			const meta = raw.raw_user_meta_data ?? {};
			const split = splitFullName(meta.full_name);

			return {
				createdAtMs:
					raw.created_at === undefined
						? Date.now()
						: Date.parse(raw.created_at),
				email: raw.email,
				emailVerified: raw.email_confirmed_at !== undefined,
				externalId: raw.id,
				familyName: meta.family_name ?? split.familyName,
				givenName: meta.given_name ?? split.givenName,
				passwordHash: raw.encrypted_password,
				passwordHashAlgo: raw.encrypted_password?.startsWith('$2')
					? ('bcrypt' as const)
					: undefined
			};
		});

		const identities = (parsed.identities ?? []).map((identity) => ({
			authProvider: identity.provider,
			createdAtMs:
				identity.created_at === undefined
					? Date.now()
					: Date.parse(identity.created_at),
			providerSubject: identity.provider_id,
			userExternalId: identity.user_id
		}));

		return { identities, source: 'supabase', users };
	}
};
