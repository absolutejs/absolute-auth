import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import {
	bigint,
	jsonb,
	pgTable,
	text,
	timestamp,
	varchar
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
	sub: varchar('sub', { length: 36 }).primaryKey(),
	first_name: varchar('first_name', { length: 255 }),
	last_name: varchar('last_name', { length: 255 }),
	email: varchar('email', { length: 320 }),
	created_at: timestamp('created_at').notNull().defaultNow(),
	primary_auth_identity_id: varchar('primary_auth_identity_id', {
		length: 255
	})
});

export const authIdentities = pgTable('auth_identities', {
	id: varchar('id', { length: 255 }).primaryKey(),
	user_sub: varchar('user_sub', { length: 255 }).notNull(),
	auth_provider: varchar('auth_provider', { length: 64 }).notNull(),
	provider_subject: varchar('provider_subject', { length: 255 }).notNull(),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
	created_at: timestamp('created_at').notNull().defaultNow(),
	updated_at: timestamp('updated_at').notNull().defaultNow()
});

export const authIdentityMergeRequests = pgTable(
	'auth_identity_merge_requests',
	{
		id: varchar('id', { length: 255 }).primaryKey(),
		target_user_sub: varchar('target_user_sub', { length: 255 }).notNull(),
		source_user_sub: varchar('source_user_sub', { length: 255 }).notNull(),
		conflicting_auth_provider: varchar('conflicting_auth_provider', {
			length: 64
		}).notNull(),
		conflicting_provider_subject: varchar('conflicting_provider_subject', {
			length: 255
		}).notNull(),
		status: varchar('status', { length: 64 }).notNull(),
		metadata: jsonb('metadata')
			.$type<Record<string, unknown>>()
			.default({}),
		created_at: timestamp('created_at').notNull().defaultNow(),
		updated_at: timestamp('updated_at').notNull().defaultNow()
	}
);

export const authSessions = pgTable('auth_sessions', {
	id: varchar('id', { length: 255 }).primaryKey(),
	access_token: text('access_token').notNull(),
	refresh_token: text('refresh_token'),
	expires_at_ms: bigint('expires_at_ms', { mode: 'number' }).notNull(),
	user_json: jsonb('user_json').$type<Record<string, unknown>>().notNull(),
	created_at: timestamp('created_at').notNull().defaultNow(),
	updated_at: timestamp('updated_at').notNull().defaultNow()
});

export const authUnregisteredSessions = pgTable('auth_unregistered_sessions', {
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
});

export const linkedProviderGrants = pgTable('linked_provider_grants', {
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

export const linkedProviderBindings = pgTable('linked_provider_bindings', {
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

export const schema = {
	users,
	authIdentities,
	authIdentityMergeRequests,
	authSessions,
	authUnregisteredSessions,
	linkedProviderGrants,
	linkedProviderBindings
};

export type SchemaType = typeof schema;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthIdentity = typeof authIdentities.$inferSelect;
export type NewAuthIdentity = typeof authIdentities.$inferInsert;
export type AuthIdentityMergeRequest =
	typeof authIdentityMergeRequests.$inferSelect;
export type NewAuthIdentityMergeRequest =
	typeof authIdentityMergeRequests.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
export type AuthUnregisteredSession =
	typeof authUnregisteredSessions.$inferSelect;
export type NewAuthUnregisteredSession =
	typeof authUnregisteredSessions.$inferInsert;
export type LinkedProviderGrantRow = typeof linkedProviderGrants.$inferSelect;
export type NewLinkedProviderGrantRow =
	typeof linkedProviderGrants.$inferInsert;
export type LinkedProviderBindingRow =
	typeof linkedProviderBindings.$inferSelect;
export type NewLinkedProviderBindingRow =
	typeof linkedProviderBindings.$inferInsert;

export type DatabaseFunctionProps = {
	db: NeonHttpDatabase<SchemaType>;
	schema: SchemaType;
};
