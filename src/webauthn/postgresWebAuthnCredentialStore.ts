import { eq } from 'drizzle-orm';
import {
	bigint,
	boolean,
	jsonb,
	pgTable,
	text,
	varchar
} from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { WebAuthnCredential, WebAuthnCredentialStore } from './types';

const ID_LENGTH = 255;
const DEVICE_TYPE_LENGTH = 32;

export const webauthnCredentialsTable = pgTable('auth_webauthn_credentials', {
	backed_up: boolean('backed_up'),
	counter: bigint('counter', { mode: 'number' }).notNull().default(0),
	created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
	credential_id: varchar('credential_id', { length: ID_LENGTH }).primaryKey(),
	device_type: varchar('device_type', { length: DEVICE_TYPE_LENGTH }),
	last_used_at_ms: bigint('last_used_at_ms', { mode: 'number' }),
	public_key: text('public_key').notNull(),
	transports: jsonb('transports').$type<string[]>(),
	user_id: varchar('user_id', { length: ID_LENGTH }).notNull()
});

type WebAuthnRow = typeof webauthnCredentialsTable.$inferSelect;
type WebAuthnInsert = typeof webauthnCredentialsTable.$inferInsert;

const toCredential = (row: WebAuthnRow): WebAuthnCredential => ({
	backedUp: row.backed_up ?? undefined,
	counter: row.counter,
	createdAt: row.created_at_ms,
	credentialId: row.credential_id,
	deviceType: row.device_type ?? undefined,
	lastUsedAt: row.last_used_at_ms ?? undefined,
	publicKey: row.public_key,
	transports: row.transports ?? undefined,
	userId: row.user_id
});

const toValues = (credential: WebAuthnCredential): WebAuthnInsert => ({
	backed_up: credential.backedUp ?? null,
	counter: credential.counter,
	created_at_ms: credential.createdAt,
	credential_id: credential.credentialId,
	device_type: credential.deviceType ?? null,
	last_used_at_ms: credential.lastUsedAt ?? null,
	public_key: credential.publicKey,
	transports: credential.transports ?? null,
	user_id: credential.userId
});

export const createNeonWebAuthnCredentialStore = (databaseUrl: string) =>
	createPostgresWebAuthnCredentialStore(createNeonDatabase(databaseUrl));
export const createPostgresWebAuthnCredentialStore = (
	db: AnyPgDatabase
): WebAuthnCredentialStore => ({
	getCredential: async (credentialId) => {
		const [row] = await db
			.select()
			.from(webauthnCredentialsTable)
			.where(eq(webauthnCredentialsTable.credential_id, credentialId))
			.limit(1);

		return row ? toCredential(row) : undefined;
	},
	listCredentialsByUser: async (userId) => {
		const rows = await db
			.select()
			.from(webauthnCredentialsTable)
			.where(eq(webauthnCredentialsTable.user_id, userId));

		return rows.map(toCredential);
	},
	removeCredential: async (credentialId) => {
		await db
			.delete(webauthnCredentialsTable)
			.where(eq(webauthnCredentialsTable.credential_id, credentialId));
	},
	saveCredential: async (credential) => {
		const values = toValues(credential);
		await db
			.insert(webauthnCredentialsTable)
			.values(values)
			.onConflictDoUpdate({
				set: values,
				target: webauthnCredentialsTable.credential_id
			});
	}
});
