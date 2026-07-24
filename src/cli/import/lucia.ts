// Lucia v3 user importer.
//
// Lucia (deprecated 2024) keeps users in `user` + key/identity rows in
// `key` (or `oauth_account` depending on adapter). Export both tables
// as JSON arrays and concatenate:
//
//   {
//     "users": [{ "id": "abc...", "email": "alice@x", "created_at": 17... }, …],
//     "keys":  [
//       { "id": "email:alice@x", "user_id": "abc...", "hashed_password": "$argon2id$..." },
//       { "id": "google:118392...", "user_id": "abc..." }
//     ]
//   }
//
// Lucia's default hash is argon2id from `oslo/password`; verbatim copy
// works.

import { readFile } from 'node:fs/promises';
import {
	detectPasswordHashAlgorithm,
	type ImportResult,
	type Importer
} from './types';

type LuciaUser = {
	created_at?: number | string;
	email?: string;
	id: string;
};

type LuciaKey = {
	hashed_password?: string;
	id: string;
	user_id: string;
};

type LuciaExport = {
	keys?: LuciaKey[];
	users: LuciaUser[];
};

const toMs = (value: number | string | undefined) => {
	if (value === undefined) return Date.now();
	if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;

	return Date.parse(value);
};

const classifyLuciaKey = (
	key: LuciaKey,
	passwordByUserId: Map<string, string | undefined>,
	oauthKeys: LuciaKey[]
) => {
	const separator = key.id.indexOf(':');
	if (separator < 0) return;
	const provider = key.id.slice(0, separator);
	if (provider === 'email' || provider === 'username') {
		passwordByUserId.set(key.user_id, key.hashed_password);

		return;
	}
	oauthKeys.push(key);
};

export const luciaImporter: Importer = {
	source: 'lucia',
	parse: async (path: string): Promise<ImportResult> => {
		const text = await readFile(path, 'utf-8');
		const parsed: LuciaExport = JSON.parse(text);

		// Lucia's keys are formatted as `provider:subject`. The `email:`
		// keys carry the password hash; OAuth keys (`google:`, `github:`,
		// …) are the identities.
		const passwordByUserId = new Map<string, string | undefined>();
		const oauthKeys: LuciaKey[] = [];
		for (const key of parsed.keys ?? []) {
			classifyLuciaKey(key, passwordByUserId, oauthKeys);
		}

		const users = parsed.users.map((raw) => ({
			createdAtMs: toMs(raw.created_at),
			email: raw.email ?? '',
			emailVerified: true,
			externalId: raw.id,
			passwordHash: passwordByUserId.get(raw.id),
				passwordHashAlgo: detectPasswordHashAlgorithm(
					passwordByUserId.get(raw.id)
				)
		}));

		const identities = oauthKeys.map((key) => {
			const separator = key.id.indexOf(':');

			return {
				authProvider: key.id.slice(0, separator),
				createdAtMs: Date.now(),
				providerSubject: key.id.slice(separator + 1),
				userExternalId: key.user_id
			};
		});

		return { identities, source: 'lucia', users };
	}
};
