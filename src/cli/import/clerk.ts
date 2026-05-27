// Clerk user export importer.
//
// Clerk doesn't expose a CSV export from the dashboard (as of 2026), but
// you can iterate every user via GET /v1/users?limit=500&offset=N from
// the backend API. The shape is:
//
//   {
//     "id": "user_2N...",
//     "email_addresses": [{ "email_address": "alice@x", "verification": { "status": "verified" } }],
//     "external_accounts": [{ "provider": "oauth_google", "external_id": "1183..." }],
//     "first_name": "Alice",
//     "last_name": "Smith",
//     "created_at": 1709999999000,
//     "password_enabled": true,
//     "password_digest": "$argon2id$..."   // requires the password-export beta
//   }
//
// Save the concatenated result as a single JSON array file → pass to
// this importer. Clerk uses argon2id by default; verbatim copy works.

import { readFile } from 'node:fs/promises';
import type { ImportResult, Importer } from './types';

type ClerkEmail = {
	email_address: string;
	verification?: { status?: string };
};

type ClerkExternalAccount = {
	external_id?: string;
	provider: string;
	provider_user_id?: string;
};

type ClerkUser = {
	created_at?: number;
	email_addresses?: ClerkEmail[];
	external_accounts?: ClerkExternalAccount[];
	first_name?: string;
	id: string;
	last_name?: string;
	password_digest?: string;
	primary_email_address_id?: string;
};

const stripOauthPrefix = (provider: string) =>
	provider.startsWith('oauth_') ? provider.slice('oauth_'.length) : provider;

export const clerkImporter: Importer = {
	source: 'clerk',
	parse: async (path: string): Promise<ImportResult> => {
		const text = await readFile(path, 'utf-8');
		const clerkUsers: ClerkUser[] = JSON.parse(text);

		const users = clerkUsers
			.filter(
				(raw) =>
					raw.email_addresses !== undefined &&
					raw.email_addresses.length > 0
			)
			.map((raw) => {
				const primary =
					raw.email_addresses?.find(
						(e) =>
							raw.primary_email_address_id === undefined ||
							e.email_address.length > 0
					) ?? raw.email_addresses?.[0];

				return {
					createdAtMs: raw.created_at ?? Date.now(),
					email: primary?.email_address ?? '',
					emailVerified: primary?.verification?.status === 'verified',
					externalId: raw.id,
					familyName: raw.last_name,
					givenName: raw.first_name,
					passwordHash: raw.password_digest,
					passwordHashAlgo: raw.password_digest?.startsWith('$argon2id')
						? ('argon2id' as const)
						: raw.password_digest?.startsWith('$2')
							? ('bcrypt' as const)
							: undefined
				};
			});

		const identities = clerkUsers.flatMap((raw) =>
			(raw.external_accounts ?? []).map((account) => ({
				authProvider: stripOauthPrefix(account.provider),
				createdAtMs: raw.created_at ?? Date.now(),
				providerSubject:
					account.provider_user_id ?? account.external_id ?? '',
				userExternalId: raw.id
			}))
		);

		return { identities, source: 'clerk', users };
	}
};
