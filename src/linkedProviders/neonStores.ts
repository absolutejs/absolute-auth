import type {
	LinkedProviderBinding,
	LinkedProviderBindingStore,
	LinkedProviderGrant,
	LinkedProviderGrantStore
} from '@absolutejs/linked-providers';
import { neon } from '@neondatabase/serverless';
import { desc, eq } from 'drizzle-orm';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import {
	type AnyPgTable,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar
} from 'drizzle-orm/pg-core';
import type { OAuth2ConfigurationOptions } from '../types';
import { createOAuthLinkedProviderCredentialResolver } from './oauthResolver';

export const linkedProviderBindingsTable = pgTable('linked_provider_bindings', {
	available_scopes: jsonb('available_scopes')
		.$type<string[]>()
		.notNull()
		.default([]),
	capabilities: jsonb('capabilities').$type<string[]>().default([]),
	connector_provider: varchar('connector_provider', { length: 64 }).notNull(),
	created_at: timestamp('created_at').notNull().defaultNow(),
	email: varchar('email', { length: 320 }),
	external_account_id: varchar('external_account_id', {
		length: 255
	}).notNull(),
	external_account_type: varchar('external_account_type', {
		length: 64
	}).notNull(),
	grant_id: varchar('grant_id', { length: 255 }).notNull(),
	id: varchar('id', { length: 255 }).primaryKey(),
	label: varchar('label', { length: 255 }),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
	status: varchar('status', { length: 64 })
		.$type<LinkedProviderBinding['status']>()
		.notNull(),
	updated_at: timestamp('updated_at').notNull().defaultNow(),
	username: varchar('username', { length: 255 })
});
export const linkedProviderGrantsTable = pgTable('linked_provider_grants', {
	access_token_ciphertext: text('access_token_ciphertext'),
	auth_provider_key: varchar('auth_provider_key', { length: 64 }).notNull(),
	created_at: timestamp('created_at').notNull().defaultNow(),
	expires_at: timestamp('expires_at'),
	granted_scopes: jsonb('granted_scopes')
		.$type<string[]>()
		.notNull()
		.default([]),
	id: varchar('id', { length: 255 }).primaryKey(),
	last_refresh_error: text('last_refresh_error'),
	last_refreshed_at: timestamp('last_refreshed_at'),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
	owner_ref: varchar('owner_ref', { length: 255 }).notNull(),
	provider_family: varchar('provider_family', { length: 64 }).notNull(),
	provider_subject: varchar('provider_subject', { length: 255 }).notNull(),
	refresh_token_ciphertext: text('refresh_token_ciphertext'),
	status: varchar('status', { length: 64 })
		.$type<LinkedProviderGrant['status']>()
		.notNull(),
	token_type: varchar('token_type', { length: 64 }),
	updated_at: timestamp('updated_at').notNull().defaultNow()
});
export const linkedProviderSchema = {
	linkedProviderBindings: linkedProviderBindingsTable,
	linkedProviderGrants: linkedProviderGrantsTable
} satisfies Record<string, AnyPgTable>;

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
	accessTokenCiphertext: row.access_token_ciphertext ?? undefined,
	authProviderKey: row.auth_provider_key,
	createdAt: row.created_at.getTime(),
	expiresAt: fromTimestamp(row.expires_at),
	grantedScopes: row.granted_scopes ?? [],
	id: row.id,
	lastRefreshedAt: fromTimestamp(row.last_refreshed_at),
	lastRefreshError: row.last_refresh_error ?? undefined,
	metadata: row.metadata ?? undefined,
	ownerRef: row.owner_ref,
	providerFamily: row.provider_family,
	providerSubject: row.provider_subject,
	refreshTokenCiphertext: row.refresh_token_ciphertext ?? undefined,
	status: row.status,
	tokenType: row.token_type ?? undefined,
	updatedAt: row.updated_at.getTime()
});

const toBinding = (row: LinkedProviderBindingRow): LinkedProviderBinding => ({
	availableScopes: row.available_scopes ?? [],
	capabilities: row.capabilities ?? undefined,
	connectorProvider: row.connector_provider,
	createdAt: row.created_at.getTime(),
	email: row.email ?? undefined,
	externalAccountId: row.external_account_id,
	externalAccountType: row.external_account_type,
	grantId: row.grant_id,
	id: row.id,
	label: row.label ?? undefined,
	metadata: row.metadata ?? undefined,
	status: row.status,
	updatedAt: row.updated_at.getTime(),
	username: row.username ?? undefined
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
	listBindingsByGrant: async (grantId) => {
		const rows = await db
			.select()
			.from(linkedProviderBindingsTable)
			.where(eq(linkedProviderBindingsTable.grant_id, grantId))
			.orderBy(desc(linkedProviderBindingsTable.updated_at));

		return rows.map(toBinding);
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
	removeBinding: async (id) => {
		await db
			.delete(linkedProviderBindingsTable)
			.where(eq(linkedProviderBindingsTable.id, id));
	},
	saveBinding: async (binding) => {
		await db
			.insert(linkedProviderBindingsTable)
			.values({
				available_scopes: binding.availableScopes,
				capabilities: binding.capabilities ?? [],
				connector_provider: binding.connectorProvider,
				created_at: new Date(binding.createdAt),
				email: binding.email ?? null,
				external_account_id: binding.externalAccountId,
				external_account_type: binding.externalAccountType,
				grant_id: binding.grantId,
				id: binding.id,
				label: binding.label ?? null,
				metadata: binding.metadata ?? {},
				status: binding.status,
				updated_at: new Date(binding.updatedAt),
				username: binding.username ?? null
			})
			.onConflictDoUpdate({
				set: {
					available_scopes: binding.availableScopes,
					capabilities: binding.capabilities ?? [],
					connector_provider: binding.connectorProvider,
					email: binding.email ?? null,
					external_account_id: binding.externalAccountId,
					external_account_type: binding.externalAccountType,
					grant_id: binding.grantId,
					label: binding.label ?? null,
					metadata: binding.metadata ?? {},
					status: binding.status,
					updated_at: new Date(binding.updatedAt),
					username: binding.username ?? null
				},
				target: linkedProviderBindingsTable.id
			});
	}
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
	removeGrant: async (id) => {
		await db
			.delete(linkedProviderBindingsTable)
			.where(eq(linkedProviderBindingsTable.grant_id, id));
		await db
			.delete(linkedProviderGrantsTable)
			.where(eq(linkedProviderGrantsTable.id, id));
	},
	saveGrant: async (grant) => {
		await db
			.insert(linkedProviderGrantsTable)
			.values({
				access_token_ciphertext: grant.accessTokenCiphertext ?? null,
				auth_provider_key: grant.authProviderKey,
				created_at: new Date(grant.createdAt),
				expires_at: toTimestamp(grant.expiresAt),
				granted_scopes: grant.grantedScopes,
				id: grant.id,
				last_refresh_error: grant.lastRefreshError ?? null,
				last_refreshed_at: toTimestamp(grant.lastRefreshedAt),
				metadata: grant.metadata ?? {},
				owner_ref: grant.ownerRef,
				provider_family: grant.providerFamily,
				provider_subject: grant.providerSubject,
				refresh_token_ciphertext: grant.refreshTokenCiphertext ?? null,
				status: grant.status,
				token_type: grant.tokenType ?? null,
				updated_at: new Date(grant.updatedAt)
			})
			.onConflictDoUpdate({
				set: {
					access_token_ciphertext:
						grant.accessTokenCiphertext ?? null,
					auth_provider_key: grant.authProviderKey,
					expires_at: toTimestamp(grant.expiresAt),
					granted_scopes: grant.grantedScopes,
					last_refresh_error: grant.lastRefreshError ?? null,
					last_refreshed_at: toTimestamp(grant.lastRefreshedAt),
					metadata: grant.metadata ?? {},
					owner_ref: grant.ownerRef,
					provider_family: grant.providerFamily,
					provider_subject: grant.providerSubject,
					refresh_token_ciphertext:
						grant.refreshTokenCiphertext ?? null,
					status: grant.status,
					token_type: grant.tokenType ?? null,
					updated_at: new Date(grant.updatedAt)
				},
				target: linkedProviderGrantsTable.id
			});
	}
});
export const createNeonLinkedProviderStores = (databaseUrl: string) => {
	const sql = neon(databaseUrl);
	const db = drizzle(sql, { schema: linkedProviderSchema });

	return {
		bindingStore: createNeonLinkedProviderBindingStore(db),
		db,
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
