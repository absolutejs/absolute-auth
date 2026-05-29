import { eq } from 'drizzle-orm';
import { bigint, pgTable, text, varchar } from 'drizzle-orm/pg-core';
import { type AnyPgDatabase, createNeonDatabase } from '../stores/postgres';
import type { SamlServiceProvider, SamlServiceProviderStore } from './types';

const ID_LENGTH = 255;
const URL_LENGTH = 2048;

export const samlServiceProvidersTable = pgTable(
	'auth_saml_service_providers',
	{
		acs_url: varchar('acs_url', { length: URL_LENGTH }).notNull(),
		created_at_ms: bigint('created_at_ms', { mode: 'number' }).notNull(),
		entity_id: varchar('entity_id', { length: URL_LENGTH }).primaryKey(),
		name_id_format: varchar('name_id_format', { length: ID_LENGTH }),
		signing_cert: text('signing_cert'),
		updated_at_ms: bigint('updated_at_ms', { mode: 'number' }).notNull()
	}
);

type Row = typeof samlServiceProvidersTable.$inferSelect;

const toServiceProvider = (row: Row): SamlServiceProvider => ({
	acsUrl: row.acs_url,
	createdAt: row.created_at_ms,
	entityId: row.entity_id,
	nameIdFormat: row.name_id_format ?? undefined,
	signingCert: row.signing_cert ?? undefined,
	updatedAt: row.updated_at_ms
});

const toValues = (
	serviceProvider: SamlServiceProvider
): typeof samlServiceProvidersTable.$inferInsert => ({
	acs_url: serviceProvider.acsUrl,
	created_at_ms: serviceProvider.createdAt,
	entity_id: serviceProvider.entityId,
	name_id_format: serviceProvider.nameIdFormat ?? null,
	signing_cert: serviceProvider.signingCert ?? null,
	updated_at_ms: serviceProvider.updatedAt
});

export const createNeonSamlServiceProviderStore = (databaseUrl: string) =>
	createPostgresSamlServiceProviderStore(createNeonDatabase(databaseUrl));

export const createPostgresSamlServiceProviderStore = (
	db: AnyPgDatabase
): SamlServiceProviderStore => ({
	deleteServiceProvider: async (entityId) => {
		await db
			.delete(samlServiceProvidersTable)
			.where(eq(samlServiceProvidersTable.entity_id, entityId));
	},
	findServiceProvider: async (entityId) => {
		const [row] = await db
			.select()
			.from(samlServiceProvidersTable)
			.where(eq(samlServiceProvidersTable.entity_id, entityId))
			.limit(1);

		return row === undefined ? undefined : toServiceProvider(row);
	},
	listServiceProviders: async () => {
		const rows = await db.select().from(samlServiceProvidersTable);

		return rows.map(toServiceProvider);
	},
	saveServiceProvider: async (serviceProvider) => {
		await db
			.insert(samlServiceProvidersTable)
			.values(toValues(serviceProvider))
			.onConflictDoUpdate({
				set: toValues(serviceProvider),
				target: samlServiceProvidersTable.entity_id
			});
	}
});
