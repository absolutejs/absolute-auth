import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
	auth_sub: varchar('auth_sub', { length: 255 }).primaryKey(),
	created_at: timestamp('created_at').notNull().defaultNow(),
	metadata: jsonb('metadata').$type<Record<string, unknown>>().default({})
});

export const schema = {
	users
};

export type SchemaType = typeof schema;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type DatabaseFunctionProps = {
	db: NeonHttpDatabase<SchemaType>;
	schema: SchemaType;
};
