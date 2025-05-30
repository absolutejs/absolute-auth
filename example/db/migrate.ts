import { env } from 'process';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';

if (!env.DATABASE_URL) {
	throw new Error('DATABASE_URL is not set in .env file');
}

const sql = neon(env.DATABASE_URL);
const db = drizzle(sql);

const dbMigrate = async () => {
	try {
		await migrate(db, {
			migrationsFolder: './drizzle'
		});
		console.log('migration successfull');
	} catch (error) {
		throw new Error(`Migration failed: ${error}`);
	}
};

dbMigrate();
