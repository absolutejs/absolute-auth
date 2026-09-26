import { and, asc, eq } from 'drizzle-orm';
import {
	jsonb,
	pgTable,
	timestamp,
	uniqueIndex,
	varchar
} from 'drizzle-orm/pg-core';
import { AuthIdentityConflictError } from '../errors';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { JsonObject } from '../types';
import { identityId, type AuthIdentity, type AuthIdentityStore } from './types';

const ID_LENGTH = 255;
const PROVIDER_LENGTH = 64;

// Same shape apps and the CLI importer already use for `auth_identities`, plus
// `last_used_at` and a unique (provider, subject) index so one provider account can
// never open two users.
export const authIdentitiesTable = pgTable(
	'auth_identities',
	{
		auth_provider: varchar('auth_provider', {
			length: PROVIDER_LENGTH
		}).notNull(),
		created_at: timestamp('created_at').notNull().defaultNow(),
		id: varchar('id', { length: ID_LENGTH }).primaryKey(),
		last_used_at: timestamp('last_used_at'),
		metadata: jsonb('metadata').$type<JsonObject>().default({}),
		provider_subject: varchar('provider_subject', {
			length: ID_LENGTH
		}).notNull(),
		updated_at: timestamp('updated_at').notNull().defaultNow(),
		user_sub: varchar('user_sub', { length: ID_LENGTH }).notNull()
	},
	(table) => [
		uniqueIndex('auth_identities_provider_subject_idx').on(
			table.auth_provider,
			table.provider_subject
		)
	]
);

type IdentityRow = typeof authIdentitiesTable.$inferSelect;

const toIdentity = (row: IdentityRow): AuthIdentity => ({
	createdAt: row.created_at.getTime(),
	id: row.id,
	lastUsedAt: row.last_used_at?.getTime(),
	metadata: row.metadata ?? {},
	provider: row.auth_provider,
	providerSubject: row.provider_subject,
	updatedAt: row.updated_at.getTime(),
	userId: row.user_sub
});

export const createNeonIdentityStore = (databaseUrl: string) =>
	createPostgresIdentityStore(createNeonDatabase(databaseUrl));
export const createPostgresIdentityStore = <DB extends AnyPgDatabase>(
	db: DB
): AuthIdentityStore => {
	const byPair = async (provider: string, providerSubject: string) => {
		const [row] = await db
			.select()
			.from(authIdentitiesTable)
			// Match on the pair, not the id: rows written by older app code may use
			// other id formats.
			.where(
				and(
					eq(authIdentitiesTable.auth_provider, provider),
					eq(authIdentitiesTable.provider_subject, providerSubject)
				)
			)
			.limit(1);

		return row ? toIdentity(row) : undefined;
	};

	return {
		findIdentity: byPair,
		getIdentity: async (id) => {
			const [row] = await db
				.select()
				.from(authIdentitiesTable)
				.where(eq(authIdentitiesTable.id, id))
				.limit(1);

			return row ? toIdentity(row) : undefined;
		},
		linkIdentity: async ({
			metadata = {},
			provider,
			providerSubject,
			userId
		}) => {
			const [inserted] = await db
				.insert(authIdentitiesTable)
				.values({
					auth_provider: provider,
					id: identityId(provider, providerSubject),
					metadata,
					provider_subject: providerSubject,
					user_sub: userId
				})
				.onConflictDoNothing()
				.returning();
			if (inserted)
				return { identity: toIdentity(inserted), status: 'linked' };
			const existing = await byPair(provider, providerSubject);
			if (!existing)
				throw new Error('Identity insert conflicted but no row exists');
			if (existing.userId !== userId)
				throw new AuthIdentityConflictError({
					authProvider: provider,
					currentUserAuthSub: userId,
					existingUserAuthSub: existing.userId,
					providerSubject
				});

			return { identity: existing, status: 'already_linked' };
		},
		listIdentitiesByUser: async (userId) => {
			const rows = await db
				.select()
				.from(authIdentitiesTable)
				.where(eq(authIdentitiesTable.user_sub, userId))
				.orderBy(asc(authIdentitiesTable.created_at));

			return rows.map(toIdentity);
		},
		removeIdentity: async (id) => {
			await db
				.delete(authIdentitiesTable)
				.where(eq(authIdentitiesTable.id, id));
		},
		touchIdentity: async (id, usedAt) => {
			await db
				.update(authIdentitiesTable)
				.set({ last_used_at: new Date(usedAt) })
				.where(eq(authIdentitiesTable.id, id));
		}
	};
};
