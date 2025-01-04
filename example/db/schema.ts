import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
	given_name: varchar('given_name', { length: 255 }),
	family_name: varchar('family_name', { length: 255 }),
	email: varchar('email', { length: 255 }),
	created_at: timestamp('created_at').notNull().defaultNow(),
	auth_sub: varchar('auth_sub', { length: 255 }).primaryKey(),
	picture: varchar('picture', { length: 255 })
});

export const schema = {
	users
};

export type schemaType = typeof schema;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type DatabaseFunctionProps = {
	db: NeonHttpDatabase<schemaType>;
	schema: schemaType;
};
