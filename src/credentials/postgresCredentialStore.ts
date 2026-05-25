import { eq } from 'drizzle-orm';
import { bigint, boolean, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type {
	CredentialRecord,
	CredentialStatus,
	CredentialStore,
	CredentialToken
} from './types';

const EMAIL_LENGTH = 320;
const ID_LENGTH = 255;
const STATUS_LENGTH = 32;
const TOKEN_HASH_LENGTH = 255;

export const credentialsTable = pgTable('auth_credentials', {
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	email: varchar('email', { length: EMAIL_LENGTH }).primaryKey(),
	email_verified: boolean('email_verified').notNull().default(false),
	organization_id: varchar('organization_id', { length: ID_LENGTH }),
	password_hash: text('password_hash').notNull(),
	status: varchar('status', { length: STATUS_LENGTH })
		.notNull()
		.default('active'),
	updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull(),
	user_id: varchar('user_id', { length: ID_LENGTH })
});

const createTokenTable = (name: string) =>
	pgTable(name, {
		email: varchar('email', { length: EMAIL_LENGTH }).notNull(),
		expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
		token_hash: varchar('token_hash', {
			length: TOKEN_HASH_LENGTH
		}).primaryKey()
	});

export const credentialResetTokensTable = createTokenTable(
	'auth_credential_reset_tokens'
);
export const credentialVerificationTokensTable = createTokenTable(
	'auth_credential_verification_tokens'
);

type CredentialRow = typeof credentialsTable.$inferSelect;
type CredentialInsert = typeof credentialsTable.$inferInsert;
type TokenTable = ReturnType<typeof createTokenTable>;
type TokenRow = TokenTable['$inferSelect'];
type TokenInsert = TokenTable['$inferInsert'];

const CREDENTIAL_STATUSES: CredentialStatus[] = ['active', 'disabled'];

const isCredentialStatus = (value: string): value is CredentialStatus =>
	CREDENTIAL_STATUSES.some((status) => status === value);

const toCredentialRecord = (row: CredentialRow): CredentialRecord => ({
	createdAt: row.created_at_ms,
	email: row.email,
	emailVerified: row.email_verified,
	organizationId: row.organization_id ?? undefined,
	passwordHash: row.password_hash,
	status: isCredentialStatus(row.status) ? row.status : 'active',
	updatedAt: row.updated_at_ms,
	userId: row.user_id ?? undefined
});

const toToken = (row: TokenRow): CredentialToken => ({
	email: row.email,
	expiresAt: row.expires_at_ms,
	tokenHash: row.token_hash
});

const saveToken = async (
	db: AnyPgDatabase,
	table: TokenTable,
	token: CredentialToken
) => {
	const values: TokenInsert = {
		email: token.email.toLowerCase(),
		expires_at_ms: token.expiresAt,
		token_hash: token.tokenHash
	};
	await db
		.insert(table)
		.values(values)
		.onConflictDoUpdate({ set: values, target: table.token_hash });
};

const consumeToken = async (
	db: AnyPgDatabase,
	table: TokenTable,
	tokenHash: string
) => {
	const [row] = await db
		.select()
		.from(table)
		.where(eq(table.token_hash, tokenHash))
		.limit(1);
	if (!row) return undefined;

	await db.delete(table).where(eq(table.token_hash, tokenHash));
	if (row.expires_at_ms < Date.now()) return undefined;

	return toToken(row);
};

export const createNeonCredentialStore = (databaseUrl: string) =>
	createPostgresCredentialStore(createNeonDatabase(databaseUrl));
export const createPostgresCredentialStore = (
	db: AnyPgDatabase
): CredentialStore => ({
	consumeResetToken: (tokenHash) =>
		consumeToken(db, credentialResetTokensTable, tokenHash),
	consumeVerificationToken: (tokenHash) =>
		consumeToken(db, credentialVerificationTokensTable, tokenHash),
	getCredentialByEmail: async (email) => {
		const [row] = await db
			.select()
			.from(credentialsTable)
			.where(eq(credentialsTable.email, email.toLowerCase()))
			.limit(1);

		return row ? toCredentialRecord(row) : undefined;
	},
	saveCredential: async (credential) => {
		const values: CredentialInsert = {
			created_at_ms: credential.createdAt,
			email: credential.email.toLowerCase(),
			email_verified: credential.emailVerified,
			organization_id: credential.organizationId ?? null,
			password_hash: credential.passwordHash,
			status: credential.status,
			updated_at_ms: credential.updatedAt,
			user_id: credential.userId ?? null
		};
		await db
			.insert(credentialsTable)
			.values(values)
			.onConflictDoUpdate({
				set: values,
				target: credentialsTable.email
			});
	},
	saveResetToken: (token) => saveToken(db, credentialResetTokensTable, token),
	saveVerificationToken: (token) =>
		saveToken(db, credentialVerificationTokensTable, token),
	setEmailVerified: async (email) => {
		await db
			.update(credentialsTable)
			.set({ email_verified: true, updated_at_ms: Date.now() })
			.where(eq(credentialsTable.email, email.toLowerCase()));
	}
});
