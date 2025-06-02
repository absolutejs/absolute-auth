import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL must be set in the environment variables');
}

export default defineConfig({
	dialect: 'postgresql',
	schema: './db/schema.ts',
	out: './db/migrations',
	dbCredentials: {
		url: process.env.DATABASE_URL
	}
});