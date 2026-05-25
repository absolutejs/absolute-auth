import { neon } from '@neondatabase/serverless';
import { eq } from 'drizzle-orm';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import {
	type AnyPgTable,
	bigint,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar
} from 'drizzle-orm/pg-core';
import { isUserSessionId } from '../typeGuards';
import type { SessionData, UnregisteredSessionData } from '../types';
import type { AuthSessionStore } from './types';

export const authSessionsTable = pgTable('auth_sessions', {
	access_token: text('access_token'),
	authenticated_at_ms: bigint('authenticated_at_ms', { mode: 'number' }),
	created_at: timestamp('created_at').notNull().defaultNow(),
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
	id: varchar('id', { length: 255 }).primaryKey(),
	refresh_token: text('refresh_token'),
	updated_at: timestamp('updated_at').notNull().defaultNow(),
	user_json: jsonb('user_json').$type<Record<string, unknown>>().notNull()
});

export const authUnregisteredSessionsTable = pgTable(
	'auth_unregistered_sessions',
	{
		access_token: text('access_token'),
		created_at: timestamp('created_at').notNull().defaultNow(),
		expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
		id: varchar('id', { length: 255 }).primaryKey(),
		refresh_token: text('refresh_token'),
		session_information_json: jsonb('session_information_json').$type<
			Record<string, unknown>
		>(),
		updated_at: timestamp('updated_at').notNull().defaultNow(),
		user_identity_json:
			jsonb('user_identity_json').$type<Record<string, unknown>>()
	}
);

export const authSessionSchema = {
	authSessions: authSessionsTable,
	authUnregisteredSessions: authUnregisteredSessionsTable
} satisfies Record<string, AnyPgTable>;

export type AuthSessionSchema = typeof authSessionSchema;

type AuthSessionRow = typeof authSessionsTable.$inferSelect;
type AuthUnregisteredSessionRow =
	typeof authUnregisteredSessionsTable.$inferSelect;

const cloneUser = <UserType>(value: UserType) => {
	if (value === null || value === undefined) return value;

	return structuredClone(value);
};

const cloneRecord = (value?: Record<string, unknown>) =>
	value ? structuredClone(value) : undefined;

const toSessionData = <UserType>(
	row: AuthSessionRow
): SessionData<UserType> => ({
	accessToken: row.access_token ?? undefined,
	authenticatedAt: row.authenticated_at_ms ?? undefined,
	expiresAt: row.expires_at_ms,
	refreshToken: row.refresh_token ?? undefined,
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- deserialization boundary: user_json was persisted from UserType, so reading it back as UserType is sound
	user: cloneUser(row.user_json as UserType)
});

const toUnregisteredSessionData = (
	row: AuthUnregisteredSessionRow
): UnregisteredSessionData => ({
	accessToken: row.access_token ?? undefined,
	expiresAt: row.expires_at_ms,
	refreshToken: row.refresh_token ?? undefined,
	sessionInformation: cloneRecord(row.session_information_json ?? undefined),
	userIdentity: cloneRecord(row.user_identity_json ?? undefined)
});

export const createNeonAuthSessionStore = <UserType>(
	databaseUrl: string
): AuthSessionStore<UserType> => {
	const sql = neon(databaseUrl);
	const db: NeonHttpDatabase<AuthSessionSchema> = drizzle(sql, {
		schema: authSessionSchema
	});

	return {
		getSession: async (id) => {
			const [row] = await db
				.select()
				.from(authSessionsTable)
				.where(eq(authSessionsTable.id, id))
				.limit(1);

			return row ? toSessionData<UserType>(row) : undefined;
		},
		getUnregisteredSession: async (id) => {
			const [row] = await db
				.select()
				.from(authUnregisteredSessionsTable)
				.where(eq(authUnregisteredSessionsTable.id, id))
				.limit(1);

			return row ? toUnregisteredSessionData(row) : undefined;
		},
		listSessionIds: async () => {
			const rows = await db
				.select({ id: authSessionsTable.id })
				.from(authSessionsTable);

			return rows.map((row) => row.id).filter(isUserSessionId);
		},
		listUnregisteredSessionIds: async () => {
			const rows = await db
				.select({ id: authUnregisteredSessionsTable.id })
				.from(authUnregisteredSessionsTable);

			return rows.map((row) => row.id).filter(isUserSessionId);
		},
		removeSession: async (id) => {
			await db
				.delete(authSessionsTable)
				.where(eq(authSessionsTable.id, id));
		},
		removeUnregisteredSession: async (id) => {
			await db
				.delete(authUnregisteredSessionsTable)
				.where(eq(authUnregisteredSessionsTable.id, id));
		},
		setSession: async (id, value) => {
			await db
				.insert(authSessionsTable)
				.values({
					access_token: value.accessToken ?? null,
					authenticated_at_ms: value.authenticatedAt ?? null,
					expires_at_ms: value.expiresAt,
					id,
					refresh_token: value.refreshToken ?? null,
					updated_at: new Date(),
					user_json: value.user ?? {}
				})
				.onConflictDoUpdate({
					set: {
						access_token: value.accessToken ?? null,
						authenticated_at_ms: value.authenticatedAt ?? null,
						expires_at_ms: value.expiresAt,
						refresh_token: value.refreshToken ?? null,
						updated_at: new Date(),
						user_json: value.user ?? {}
					},
					target: authSessionsTable.id
				});
		},
		setUnregisteredSession: async (id, value) => {
			await db
				.insert(authUnregisteredSessionsTable)
				.values({
					access_token: value.accessToken ?? null,
					expires_at_ms: value.expiresAt,
					id,
					refresh_token: value.refreshToken ?? null,
					session_information_json: value.sessionInformation ?? null,
					updated_at: new Date(),
					user_identity_json: value.userIdentity ?? null
				})
				.onConflictDoUpdate({
					set: {
						access_token: value.accessToken ?? null,
						expires_at_ms: value.expiresAt,
						refresh_token: value.refreshToken ?? null,
						session_information_json:
							value.sessionInformation ?? null,
						updated_at: new Date(),
						user_identity_json: value.userIdentity ?? null
					},
					target: authUnregisteredSessionsTable.id
				});
		}
	};
};
