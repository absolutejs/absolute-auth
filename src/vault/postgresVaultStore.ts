import { and, eq } from 'drizzle-orm';
import { bigint, pgTable, primaryKey, text, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { VaultEntry, VaultStore } from './types';

const ID_LENGTH = 255;

export const vaultEntriesTable = pgTable(
	'auth_vault_entries',
	{
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		encrypted_value: text('encrypted_value').notNull(),
		name: varchar('name', { length: ID_LENGTH }).notNull(),
		owner_id: varchar('owner_id', { length: ID_LENGTH }).notNull(),
		updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull()
	},
	(table) => ({ pk: primaryKey({ columns: [table.owner_id, table.name] }) })
);

type Row = typeof vaultEntriesTable.$inferSelect;

const toEntry = (row: Row): VaultEntry => ({
	createdAt: row.created_at_ms,
	encryptedValue: row.encrypted_value,
	name: row.name,
	ownerId: row.owner_id,
	updatedAt: row.updated_at_ms
});

export const createNeonVaultStore = (databaseUrl: string) =>
	createPostgresVaultStore(createNeonDatabase(databaseUrl));
export const createPostgresVaultStore = (db: AnyPgDatabase): VaultStore => ({
	deleteEntry: async (ownerId, name) => {
		await db
			.delete(vaultEntriesTable)
			.where(
				and(
					eq(vaultEntriesTable.owner_id, ownerId),
					eq(vaultEntriesTable.name, name)
				)
			);
	},
	getEntry: async (ownerId, name) => {
		const [row] = await db
			.select()
			.from(vaultEntriesTable)
			.where(
				and(
					eq(vaultEntriesTable.owner_id, ownerId),
					eq(vaultEntriesTable.name, name)
				)
			);

		return row ? toEntry(row) : undefined;
	},
	listAllEntries: async () => {
		const rows = await db.select().from(vaultEntriesTable);

		return rows.map(toEntry);
	},
	listEntries: async (ownerId) => {
		const rows = await db
			.select()
			.from(vaultEntriesTable)
			.where(eq(vaultEntriesTable.owner_id, ownerId));

		return rows.map(toEntry);
	},
	saveEntry: async (entry) => {
		await db
			.insert(vaultEntriesTable)
			.values({
				created_at_ms: entry.createdAt,
				encrypted_value: entry.encryptedValue,
				name: entry.name,
				owner_id: entry.ownerId,
				updated_at_ms: entry.updatedAt
			})
			.onConflictDoUpdate({
				set: {
					encrypted_value: entry.encryptedValue,
					updated_at_ms: entry.updatedAt
				},
				target: [vaultEntriesTable.owner_id, vaultEntriesTable.name]
			});
	}
});
