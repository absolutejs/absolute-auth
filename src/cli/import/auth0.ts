// Auth0 user export importer.
//
// Auth0's user export comes as a JSON or NDJSON file (depending on which
// export endpoint you used). Each line/object is a user with this shape
// (fields you'll always see):
//
//   {
//     "user_id": "auth0|663c...",
//     "email": "alice@example.com",
//     "email_verified": true,
//     "name": "Alice",
//     "given_name": "Alice",
//     "family_name": "Smith",
//     "created_at": "2024-03-12T...",
//     "identities": [
//       { "provider": "auth0", "user_id": "663c...", "connection": "Username-Password-Authentication" },
//       { "provider": "google-oauth2", "user_id": "11839...", ...}
//     ],
//     "password_hash": "$2b$10$..."   // present if export-with-passwords was enabled
//   }
//
// Get the export via: Auth0 dashboard → User Management → Users → Export.
// Or programmatically: POST /api/v2/jobs/users-exports with fields=password_hash.
// Auth0 hashes with bcrypt by default; verbatim copy works.

import { readFile } from 'node:fs/promises';
import type { ImportResult, Importer } from './types';

type Auth0Identity = {
	connection?: string;
	provider: string;
	user_id: string;
};

type Auth0User = {
	created_at?: string;
	email: string;
	email_verified?: boolean;
	family_name?: string;
	given_name?: string;
	identities?: Auth0Identity[];
	name?: string;
	password_hash?: string;
	user_id: string;
};

const parseUsersFromText = (text: string): Auth0User[] => {
	const trimmed = text.trim();
	if (trimmed.startsWith('[')) {
		return JSON.parse(trimmed) as Auth0User[];
	}

	// NDJSON — one user per line.
	return trimmed
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Auth0User);
};

export const auth0Importer: Importer = {
	source: 'auth0',
	parse: async (path: string): Promise<ImportResult> => {
		const text = await readFile(path, 'utf-8');
		const auth0Users = parseUsersFromText(text);

		const users = auth0Users.map((raw) => ({
			createdAtMs:
				raw.created_at === undefined
					? Date.now()
					: Date.parse(raw.created_at),
			email: raw.email,
			emailVerified: raw.email_verified ?? false,
			externalId: raw.user_id,
			familyName: raw.family_name,
			givenName: raw.given_name,
			passwordHash: raw.password_hash,
			passwordHashAlgo:
				raw.password_hash?.startsWith('$2b$') ||
				raw.password_hash?.startsWith('$2a$') ||
				raw.password_hash?.startsWith('$2y$')
					? ('bcrypt' as const)
					: undefined
		}));

		// Auth0 always has at least one identity (the auth0 connection
		// itself); skip that one. Real OAuth identities are
		// google-oauth2 / github / apple / etc.
		const identities = auth0Users.flatMap((raw) =>
			(raw.identities ?? [])
				.filter((identity) => identity.provider !== 'auth0')
				.map((identity) => ({
					authProvider: identity.provider.replace('-oauth2', ''),
					createdAtMs:
						raw.created_at === undefined
							? Date.now()
							: Date.parse(raw.created_at),
					metadata:
						identity.connection === undefined
							? undefined
							: { connection: identity.connection },
					providerSubject: identity.user_id,
					userExternalId: raw.user_id
				}))
		);

		return { identities, source: 'auth0', users };
	}
};
