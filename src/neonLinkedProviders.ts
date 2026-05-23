import { neon } from '@neondatabase/serverless';
import { desc, eq } from 'drizzle-orm';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import type {
	LinkedProviderBinding,
	LinkedProviderBindingStore,
	LinkedProviderGrant,
	LinkedProviderGrantStore
} from '@absolutejs/linked-providers';
import { createOAuthLinkedProviderCredentialResolver } from './oauthLinkedProviderResolver';
import type { OAuth2ConfigurationOptions } from './types';

export const linkedProviderGrantsTable = pgTable('linked_provider_grants', {
	id: varchar('id', { length: 255 }).primaryKey(),
	owner_ref: varchar('owner_ref', { length: 255 }).notNull(),
	provider_family: varchar('provider_family', { length: 64 }).notNull(),
	auth_provider_key: varchar('auth_provider_key', { length: 64 }).notNull(),
	provider_subject: varchar('provider_subject', { length: 255 }).notNull(),
	status: varchar('status', { length: 64 }).notNull(),
	granted_scopes: jsonb('granted_scopes')
		.$type<string[]>()
		.notNull()
		.default([]),
	access_token_ciphertext: text('access_token_ciphertext'),
	refresh_token_ciphertext: text('refresh_token_ciphertext'),
	token_type: varchar('token_type', { length: 64 }),
	expires_at: timestamp('expires_at'),
	last_refreshed_at: timestamp('last_refreshed_at'),
	last_refresh_error: text('last_refresh_error'),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
	created_at: timestamp('created_at').notNull().defaultNow(),
	updated_at: timestamp('updated_at').notNull().defaultNow()
});

export const linkedProviderBindingsTable = pgTable('linked_provider_bindings', {
	id: varchar('id', { length: 255 }).primaryKey(),
	grant_id: varchar('grant_id', { length: 255 }).notNull(),
	connector_provider: varchar('connector_provider', { length: 64 }).notNull(),
	external_account_id: varchar('external_account_id', {
		length: 255
	}).notNull(),
	external_account_type: varchar('external_account_type', {
		length: 64
	}).notNull(),
	label: varchar('label', { length: 255 }),
	username: varchar('username', { length: 255 }),
	email: varchar('email', { length: 320 }),
	status: varchar('status', { length: 64 }).notNull(),
	available_scopes: jsonb('available_scopes')
		.$type<string[]>()
		.notNull()
		.default([]),
	capabilities: jsonb('capabilities').$type<string[]>().default([]),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
	created_at: timestamp('created_at').notNull().defaultNow(),
	updated_at: timestamp('updated_at').notNull().defaultNow()
});

export const linkedProviderSchema = {
	linkedProviderBindings: linkedProviderBindingsTable,
	linkedProviderGrants: linkedProviderGrantsTable
};

export type LinkedProviderSchema = typeof linkedProviderSchema;
export type LinkedProviderGrantRow =
	typeof linkedProviderGrantsTable.$inferSelect;
export type LinkedProviderBindingRow =
	typeof linkedProviderBindingsTable.$inferSelect;

const toTimestamp = (value: number | undefined) =>
	value === undefined ? null : new Date(value);

const fromTimestamp = (value: Date | null) =>
	value === null ? undefined : value.getTime();

const toGrant = (row: LinkedProviderGrantRow): LinkedProviderGrant => ({
	id: row.id,
	ownerRef: row.owner_ref,
	providerFamily: row.provider_family,
	authProviderKey: row.auth_provider_key,
	providerSubject: row.provider_subject,
	status: row.status as LinkedProviderGrant['status'],
	grantedScopes: row.granted_scopes ?? [],
	accessTokenCiphertext: row.access_token_ciphertext ?? undefined,
	refreshTokenCiphertext: row.refresh_token_ciphertext ?? undefined,
	tokenType: row.token_type ?? undefined,
	expiresAt: fromTimestamp(row.expires_at),
	lastRefreshedAt: fromTimestamp(row.last_refreshed_at),
	lastRefreshError: row.last_refresh_error ?? undefined,
	metadata: row.metadata ?? undefined,
	createdAt: row.created_at.getTime(),
	updatedAt: row.updated_at.getTime()
});

const toBinding = (row: LinkedProviderBindingRow): LinkedProviderBinding => ({
	id: row.id,
	grantId: row.grant_id,
	connectorProvider: row.connector_provider,
	externalAccountId: row.external_account_id,
	externalAccountType: row.external_account_type,
	label: row.label ?? undefined,
	username: row.username ?? undefined,
	email: row.email ?? undefined,
	status: row.status as LinkedProviderBinding['status'],
	availableScopes: row.available_scopes ?? [],
	capabilities: row.capabilities ?? undefined,
	metadata: row.metadata ?? undefined,
	createdAt: row.created_at.getTime(),
	updatedAt: row.updated_at.getTime()
});

export const createNeonLinkedProviderGrantStore = (
	db: NeonHttpDatabase<LinkedProviderSchema>
): LinkedProviderGrantStore => ({
	getGrant: async (id) => {
		const [row] = await db
			.select()
			.from(linkedProviderGrantsTable)
			.where(eq(linkedProviderGrantsTable.id, id))
			.limit(1);

		return row ? toGrant(row) : undefined;
	},
	listGrantsByOwner: async (ownerRef) => {
		const rows = await db
			.select()
			.from(linkedProviderGrantsTable)
			.where(eq(linkedProviderGrantsTable.owner_ref, ownerRef))
			.orderBy(desc(linkedProviderGrantsTable.updated_at));

		return rows.map(toGrant);
	},
	saveGrant: async (grant) => {
		await db
			.insert(linkedProviderGrantsTable)
			.values({
				id: grant.id,
				owner_ref: grant.ownerRef,
				provider_family: grant.providerFamily,
				auth_provider_key: grant.authProviderKey,
				provider_subject: grant.providerSubject,
				status: grant.status,
				granted_scopes: grant.grantedScopes,
				access_token_ciphertext: grant.accessTokenCiphertext ?? null,
				refresh_token_ciphertext: grant.refreshTokenCiphertext ?? null,
				token_type: grant.tokenType ?? null,
				expires_at: toTimestamp(grant.expiresAt),
				last_refreshed_at: toTimestamp(grant.lastRefreshedAt),
				last_refresh_error: grant.lastRefreshError ?? null,
				metadata: grant.metadata ?? {},
				created_at: new Date(grant.createdAt),
				updated_at: new Date(grant.updatedAt)
			})
			.onConflictDoUpdate({
				target: linkedProviderGrantsTable.id,
				set: {
					owner_ref: grant.ownerRef,
					provider_family: grant.providerFamily,
					auth_provider_key: grant.authProviderKey,
					provider_subject: grant.providerSubject,
					status: grant.status,
					granted_scopes: grant.grantedScopes,
					access_token_ciphertext:
						grant.accessTokenCiphertext ?? null,
					refresh_token_ciphertext:
						grant.refreshTokenCiphertext ?? null,
					token_type: grant.tokenType ?? null,
					expires_at: toTimestamp(grant.expiresAt),
					last_refreshed_at: toTimestamp(grant.lastRefreshedAt),
					last_refresh_error: grant.lastRefreshError ?? null,
					metadata: grant.metadata ?? {},
					updated_at: new Date(grant.updatedAt)
				}
			});
	},
	removeGrant: async (id) => {
		await db
			.delete(linkedProviderBindingsTable)
			.where(eq(linkedProviderBindingsTable.grant_id, id));
		await db
			.delete(linkedProviderGrantsTable)
			.where(eq(linkedProviderGrantsTable.id, id));
	}
});

export const createNeonLinkedProviderBindingStore = (
	db: NeonHttpDatabase<LinkedProviderSchema>
): LinkedProviderBindingStore => ({
	getBinding: async (id) => {
		const [row] = await db
			.select()
			.from(linkedProviderBindingsTable)
			.where(eq(linkedProviderBindingsTable.id, id))
			.limit(1);

		return row ? toBinding(row) : undefined;
	},
	listBindingsByOwner: async (ownerRef) => {
		const rows = await db
			.select({ binding: linkedProviderBindingsTable })
			.from(linkedProviderBindingsTable)
			.innerJoin(
				linkedProviderGrantsTable,
				eq(
					linkedProviderBindingsTable.grant_id,
					linkedProviderGrantsTable.id
				)
			)
			.where(eq(linkedProviderGrantsTable.owner_ref, ownerRef))
			.orderBy(desc(linkedProviderBindingsTable.updated_at));

		return rows.map(({ binding }) => toBinding(binding));
	},
	listBindingsByGrant: async (grantId) => {
		const rows = await db
			.select()
			.from(linkedProviderBindingsTable)
			.where(eq(linkedProviderBindingsTable.grant_id, grantId))
			.orderBy(desc(linkedProviderBindingsTable.updated_at));

		return rows.map(toBinding);
	},
	saveBinding: async (binding) => {
		await db
			.insert(linkedProviderBindingsTable)
			.values({
				id: binding.id,
				grant_id: binding.grantId,
				connector_provider: binding.connectorProvider,
				external_account_id: binding.externalAccountId,
				external_account_type: binding.externalAccountType,
				label: binding.label ?? null,
				username: binding.username ?? null,
				email: binding.email ?? null,
				status: binding.status,
				available_scopes: binding.availableScopes,
				capabilities: binding.capabilities ?? [],
				metadata: binding.metadata ?? {},
				created_at: new Date(binding.createdAt),
				updated_at: new Date(binding.updatedAt)
			})
			.onConflictDoUpdate({
				target: linkedProviderBindingsTable.id,
				set: {
					grant_id: binding.grantId,
					connector_provider: binding.connectorProvider,
					external_account_id: binding.externalAccountId,
					external_account_type: binding.externalAccountType,
					label: binding.label ?? null,
					username: binding.username ?? null,
					email: binding.email ?? null,
					status: binding.status,
					available_scopes: binding.availableScopes,
					capabilities: binding.capabilities ?? [],
					metadata: binding.metadata ?? {},
					updated_at: new Date(binding.updatedAt)
				}
			});
	},
	removeBinding: async (id) => {
		await db
			.delete(linkedProviderBindingsTable)
			.where(eq(linkedProviderBindingsTable.id, id));
	}
});

export const createNeonLinkedProviderStores = (databaseUrl: string) => {
	const sql = neon(databaseUrl);
	const db = drizzle(sql, { schema: linkedProviderSchema });

	return {
		db,
		bindingStore: createNeonLinkedProviderBindingStore(db),
		grantStore: createNeonLinkedProviderGrantStore(db)
	};
};

export type CreateNeonOAuthLinkedProviderCredentialResolverOptions = {
	databaseUrl: string;
	providersConfiguration: OAuth2ConfigurationOptions;
	now?: () => number;
};

export const createNeonOAuthLinkedProviderCredentialResolver = async ({
	databaseUrl,
	now,
	providersConfiguration
}: CreateNeonOAuthLinkedProviderCredentialResolverOptions) => {
	const stores = createNeonLinkedProviderStores(databaseUrl);

	return createOAuthLinkedProviderCredentialResolver({
		...stores,
		now,
		providersConfiguration
	});
};
