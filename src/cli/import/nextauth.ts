// NextAuth.js / Auth.js importer.
//
// NextAuth.js stores users in `users` and OAuth links in `accounts`
// (Drizzle / Prisma adapter naming). MongoDB and SQL Server adapters
// follow the same conceptual shape with different table naming.
// Concatenate the two tables as a single JSON document:
//
//   {
//     "users": [
//       { "id": "...", "email": "alice@x", "emailVerified": "2024-01-01...",
//         "name": "Alice Smith", "image": "..." },
//       …
//     ],
//     "accounts": [
//       { "userId": "...", "provider": "google", "providerAccountId": "118392...",
//         "type": "oauth" }
//     ]
//   }
//
// NextAuth doesn't ship a Credentials password store by default — its
// official guidance is to discourage passwords. If your app added a
// custom credentials provider, you'll have the hashes in your own
// custom column; pass them via the optional `passwordsByUserId` field:
//
//   { "users": […], "accounts": […],
//     "passwordsByUserId": { "user_id_1": "$argon2id$…" } }

import { readFile } from 'node:fs/promises';
import type { ImportResult, Importer } from './types';

type NextAuthUser = {
	email: string;
	emailVerified?: string | null;
	id: string;
	image?: string;
	name?: string;
};

type NextAuthAccount = {
	provider: string;
	providerAccountId: string;
	type?: string;
	userId: string;
};

type NextAuthExport = {
	accounts?: NextAuthAccount[];
	passwordsByUserId?: Record<string, string | undefined>;
	users: NextAuthUser[];
};

const splitName = (full: string | undefined) => {
	if (full === undefined) return { familyName: undefined, givenName: undefined };
	const parts = full.split(/\s+/);
	if (parts.length === 1) return { familyName: undefined, givenName: parts[0] };

	return {
		familyName: parts.slice(1).join(' '),
		givenName: parts[0]
	};
};

export const nextauthImporter: Importer = {
	source: 'nextauth',
	parse: async (path: string): Promise<ImportResult> => {
		const text = await readFile(path, 'utf-8');
		const parsed: NextAuthExport = JSON.parse(text);

		const users = parsed.users.map((raw) => {
			const split = splitName(raw.name);
			const passwordHash = parsed.passwordsByUserId?.[raw.id];

			return {
				createdAtMs: Date.now(),
				email: raw.email,
				emailVerified: raw.emailVerified !== null && raw.emailVerified !== undefined,
				externalId: raw.id,
				familyName: split.familyName,
				givenName: split.givenName,
				passwordHash,
				passwordHashAlgo: passwordHash?.startsWith('$argon2id')
					? ('argon2id' as const)
					: passwordHash?.startsWith('$2')
						? ('bcrypt' as const)
						: undefined
			};
		});

		const identities = (parsed.accounts ?? [])
			.filter((account) => account.type === undefined || account.type === 'oauth')
			.map((account) => ({
				authProvider: account.provider,
				createdAtMs: Date.now(),
				providerSubject: account.providerAccountId,
				userExternalId: account.userId
			}));

		return { identities, source: 'nextauth', users };
	}
};
