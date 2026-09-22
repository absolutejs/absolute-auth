import { expect, test } from 'bun:test';
import { runSetup, setupStorage } from '../src/cli/setup';
import { manifest } from '../src/manifest';
const memory = {
	adapters: {
		sessionStore: '@absolutejs/auth#createInMemoryAuthSessionStore'
	}
};
const neon = {
	adapters: { sessionStore: '@absolutejs/auth#createNeonAuthSessionStore' }
};
test('memory setup neither requires a database nor runs migrations', async () => {
	let calls = 0;
	const result = await runSetup({
		configuration: memory,
		databaseUrl: '',
		log: () => undefined,
		migrate: async () => {
			calls++;

			return { applied: [], skipped: [] };
		}
	});
	expect(result).toEqual({ migrated: false, storage: 'memory' });
	expect(calls).toBe(0);
});
test('persistent setup requires a real configured connection and runs migrations', async () => {
	let calls = 0;
	const migrate = async () => {
		calls++;

		return { applied: [], skipped: [] };
	};
	await expect(
		runSetup({ configuration: neon, databaseUrl: '', migrate })
	).rejects.toThrow('requires DATABASE_URL');
	expect(calls).toBe(0);
	expect(
		await runSetup({
			configuration: neon,
			databaseUrl: 'postgres://synthetic.invalid/test',
			migrate,
			log: () => undefined
		})
	).toEqual({ migrated: true, storage: 'neon' });
	expect(calls).toBe(1);
});
test('unknown or missing storage is not silently treated as memory', () => {
	expect(() => setupStorage({})).toThrow('Select a supported');
	expect(() =>
		setupStorage({ adapters: { sessionStore: 'custom' } })
	).toThrow('Custom adapters');
});
test('database requirements belong to persistent adapters', () => {
	expect(
		manifest.requires?.env?.some((item) => item.key === 'DATABASE_URL')
	).toBe(false);
	expect(
		manifest.implements
			?.find((item) => item.factory === 'createNeonAuthSessionStore')
			?.requires?.env?.some((item) => item.key === 'DATABASE_URL')
	).toBe(true);
	expect(
		manifest.lifecycle?.every(
			(step) => step.command === 'bunx absolute-auth setup'
		)
	).toBe(true);
});
