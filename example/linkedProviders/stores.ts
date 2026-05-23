import type {
	LinkedProviderBinding,
	LinkedProviderBindingStore,
	LinkedProviderGrant,
	LinkedProviderGrantStore
} from '@absolutejs/linked-providers';
import { desc, eq } from 'drizzle-orm';
import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import {
	linkedProviderBindings,
	linkedProviderGrants,
	LinkedProviderBindingRow,
	LinkedProviderGrantRow,
	SchemaType
} from '../db/schema';

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

export const createDrizzleLinkedProviderGrantStore = (
	db: NeonHttpDatabase<SchemaType>
): LinkedProviderGrantStore => ({
	getGrant: async (id) => {
		const [row] = await db
			.select()
			.from(linkedProviderGrants)
			.where(eq(linkedProviderGrants.id, id))
			.limit(1);

		return row ? toGrant(row) : undefined;
	},
	listGrantsByOwner: async (ownerRef) => {
		const rows = await db
			.select()
			.from(linkedProviderGrants)
			.where(eq(linkedProviderGrants.owner_ref, ownerRef))
			.orderBy(desc(linkedProviderGrants.updated_at));

		return rows.map(toGrant);
	},
	saveGrant: async (grant) => {
		await db
			.insert(linkedProviderGrants)
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
				target: linkedProviderGrants.id,
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
			.delete(linkedProviderBindings)
			.where(eq(linkedProviderBindings.grant_id, id));
		await db
			.delete(linkedProviderGrants)
			.where(eq(linkedProviderGrants.id, id));
	}
});

export const createDrizzleLinkedProviderBindingStore = (
	db: NeonHttpDatabase<SchemaType>
): LinkedProviderBindingStore => ({
	getBinding: async (id) => {
		const [row] = await db
			.select()
			.from(linkedProviderBindings)
			.where(eq(linkedProviderBindings.id, id))
			.limit(1);

		return row ? toBinding(row) : undefined;
	},
	listBindingsByOwner: async (ownerRef) => {
		const rows = await db
			.select({ binding: linkedProviderBindings })
			.from(linkedProviderBindings)
			.innerJoin(
				linkedProviderGrants,
				eq(linkedProviderBindings.grant_id, linkedProviderGrants.id)
			)
			.where(eq(linkedProviderGrants.owner_ref, ownerRef))
			.orderBy(desc(linkedProviderBindings.updated_at));

		return rows.map(({ binding }) => toBinding(binding));
	},
	listBindingsByGrant: async (grantId) => {
		const rows = await db
			.select()
			.from(linkedProviderBindings)
			.where(eq(linkedProviderBindings.grant_id, grantId))
			.orderBy(desc(linkedProviderBindings.updated_at));

		return rows.map(toBinding);
	},
	saveBinding: async (binding) => {
		await db
			.insert(linkedProviderBindings)
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
				target: linkedProviderBindings.id,
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
			.delete(linkedProviderBindings)
			.where(eq(linkedProviderBindings.id, id));
	}
});

export const createDrizzleLinkedProviderStores = (
	db: NeonHttpDatabase<SchemaType>
) => ({
	bindingStore: createDrizzleLinkedProviderBindingStore(db),
	grantStore: createDrizzleLinkedProviderGrantStore(db)
});
