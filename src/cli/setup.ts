import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runMigrations } from '../migrations';

const readProperty = (value: unknown, key: string) => {
	const property: unknown =
		typeof value === 'object' && value !== null
			? Reflect.get(value, key)
			: undefined;

	return property;
};

/** A missing or unknown selection must never silently become ephemeral storage. */
export const setupStorage = (configuration: unknown) => {
	const selected = readProperty(
		readProperty(configuration, 'adapters'),
		'sessionStore'
	);
	if (selected === '@absolutejs/auth#createInMemoryAuthSessionStore')
		return 'memory';
	if (selected === '@absolutejs/auth#createNeonAuthSessionStore')
		return 'neon';
	throw new Error(
		'Select a supported auth sessionStore adapter in src/backend/packages/auth.config.ts before setup. Custom adapters need their own migrations.'
	);
};

const loadConfiguration = async () => {
	const module: unknown = await import(
		pathToFileURL(resolve('src/backend/packages/auth.config.ts')).href
	);

	return readProperty(module, 'default');
};

export const runSetup = async ({
	configuration,
	databaseUrl = process.env['DATABASE_URL'],
	migrate = runMigrations,
	log = console.log
}: {
	configuration?: unknown;
	databaseUrl?: string;
	migrate?: typeof runMigrations;
	log?: (message: string) => void;
} = {}) => {
	const storage = setupStorage(configuration ?? (await loadConfiguration()));
	if (storage === 'memory') {
		log(
			'In-memory sessions selected: no database migration is needed. Sign-ins reset on restart; choose persistent storage for a live business.'
		);

		return { migrated: false, storage };
	}
	if (!databaseUrl?.trim())
		throw new Error(
			'The selected Neon session store requires DATABASE_URL. Configure a real Neon database connection; do not enter a placeholder.'
		);
	await migrate({ databaseUrl, log });

	return { migrated: true, storage };
};
