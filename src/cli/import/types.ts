// Shared shape every importer outputs. The dispatcher does the actual DB
// writes — importers just transform source-format JSON into these
// neutral records. Keeps the per-source code small + lets us add new
// sources without refactoring the writer.

export const detectPasswordHashAlgorithm: (
	hash?: string
) => ImportedUser['passwordHashAlgo'] = (hash) => {
	if (hash?.startsWith('$argon2id')) return 'argon2id';
	if (
		hash?.startsWith('$2b$') ||
		hash?.startsWith('$2a$') ||
		hash?.startsWith('$2y$') ||
		hash?.startsWith('$2')
	)
		return 'bcrypt';

	return undefined;
};

export type ImportedUser = {
	createdAtMs: number;
	email: string;
	emailVerified: boolean;
	// Provider's primary key for this user, kept so re-imports can dedupe.
	externalId: string;
	familyName?: string;
	givenName?: string;
	// Password hash in its original format (bcrypt / argon2id / scrypt).
	// `@absolutejs/auth` writes it verbatim into users.password; the
	// rehash-on-next-login dance is handled by the credentials block at
	// runtime (it sniffs argon2id headers and reverifies via bcryptjs/scrypt
	// for legacy formats, then rewrites to argon2id on success).
	passwordHash?: string;
	passwordHashAlgo?: 'argon2id' | 'bcrypt' | 'scrypt' | 'pbkdf2';
};

export type ImportedIdentity = {
	authProvider: string;
	createdAtMs: number;
	// Anything from the source we want to keep around (e.g. Apple's
	// first-sign-in name, QuickBooks realmId).
	metadata?: Record<string, unknown>;
	providerSubject: string;
	// Match against ImportedUser.externalId to link rows.
	userExternalId: string;
};

export type ImportResult = {
	identities: ImportedIdentity[];
	source: string;
	users: ImportedUser[];
};

export type Importer = {
	// Read the file at `path` and return the neutral records. Should NOT
	// touch the database — the dispatcher does that uniformly.
	parse: (path: string) => Promise<ImportResult>;
	// User-facing label for help text + logs.
	source: string;
};
