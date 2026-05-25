import { neon } from '@neondatabase/serverless';
import { eq } from 'drizzle-orm';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import {
	bigint,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar
} from 'drizzle-orm/pg-core';
import type {
	SessionData,
	UnregisteredSessionData,
	UserSessionId
} from '../types';
import type { AuthSessionStore } from './types';

export const authSessionsTable = pgTable('auth_sessions', {
	id: varchar('id', { length: 255 }).primaryKey(),
	access_token: text('access_token').notNull(),
	refresh_token: text('refresh_token'),
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
	user_json: jsonb('user_json').$type<Record<string, unknown>>().notNull(),
	created_at: timestamp('created_at').notNull().defaultNow(),
	updated_at: timestamp('updated_at').notNull().defaultNow()
});

export const authUnregisteredSessionsTable = pgTable(
	'auth_unregistered_sessions',
	{
		id: varchar('id', { length: 255 }).primaryKey(),
		access_token: text('access_token'),
		refresh_token: text('refresh_token'),
		expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
		user_identity_json:
			jsonb('user_identity_json').$type<Record<string, unknown>>(),
		session_information_json: jsonb('session_information_json').$type<
			Record<string, unknown>
		>(),
		created_at: timestamp('created_at').notNull().defaultNow(),
		updated_at: timestamp('updated_at').notNull().defaultNow()
	}
);

export const authSessionSchema = {
	authSessions: authSessionsTable,
	authUnregisteredSessions: authUnregisteredSessionsTable
};

export type AuthSessionSchema = typeof authSessionSchema;

type AuthSessionRow = typeof authSessionsTable.$inferSelect;
type AuthUnregisteredSessionRow =
	typeof authUnregisteredSessionsTable.$inferSelect;

const cloneUser = <UserType>(value: UserType): UserType => {
	if (value === null || value === undefined) return value;
	return structuredClone(value);
};

const cloneRecord = (value?: Record<string, unknown>) =>
	value ? structuredClone(value) : undefined;

const toSessionData = <UserType>(
	row: AuthSessionRow
): SessionData<UserType> => ({
	accessToken: row.access_token,
	expiresAt: row.expires_at_ms,
	refreshToken: row.refresh_token ?? undefined,
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
		setSession: async (id, value) => {
			await db
				.insert(authSessionsTable)
				.values({
					id,
					access_token: value.accessToken,
					refresh_token: value.refreshToken ?? null,
					expires_at_ms: value.expiresAt,
					user_json: (value.user ?? {}) as Record<string, unknown>,
					updated_at: new Date()
				})
				.onConflictDoUpdate({
					target: authSessionsTable.id,
					set: {
						access_token: value.accessToken,
						refresh_token: value.refreshToken ?? null,
						expires_at_ms: value.expiresAt,
						user_json: (value.user ?? {}) as Record<
							string,
							unknown
						>,
						updated_at: new Date()
					}
				});
		},
		removeSession: async (id) => {
			await db
				.delete(authSessionsTable)
				.where(eq(authSessionsTable.id, id));
		},
		getUnregisteredSession: async (id) => {
			const [row] = await db
				.select()
				.from(authUnregisteredSessionsTable)
				.where(eq(authUnregisteredSessionsTable.id, id))
				.limit(1);

			return row ? toUnregisteredSessionData(row) : undefined;
		},
		setUnregisteredSession: async (id, value) => {
			await db
				.insert(authUnregisteredSessionsTable)
				.values({
					id,
					access_token: value.accessToken ?? null,
					refresh_token: value.refreshToken ?? null,
					expires_at_ms: value.expiresAt,
					user_identity_json: value.userIdentity ?? null,
					session_information_json: value.sessionInformation ?? null,
					updated_at: new Date()
				})
				.onConflictDoUpdate({
					target: authUnregisteredSessionsTable.id,
					set: {
						access_token: value.accessToken ?? null,
						refresh_token: value.refreshToken ?? null,
						expires_at_ms: value.expiresAt,
						user_identity_json: value.userIdentity ?? null,
						session_information_json:
							value.sessionInformation ?? null,
						updated_at: new Date()
					}
				});
		},
		removeUnregisteredSession: async (id) => {
			await db
				.delete(authUnregisteredSessionsTable)
				.where(eq(authUnregisteredSessionsTable.id, id));
		},
		listSessionIds: async () => {
			const rows = await db
				.select({ id: authSessionsTable.id })
				.from(authSessionsTable);
			return rows.map((row) => row.id as UserSessionId);
		},
		listUnregisteredSessionIds: async () => {
			const rows = await db
				.select({ id: authUnregisteredSessionsTable.id })
				.from(authUnregisteredSessionsTable);
			return rows.map((row) => row.id as UserSessionId);
		}
	};
};
