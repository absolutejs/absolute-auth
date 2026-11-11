import { expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { createPostgresCredentialStore } from '../src/credentials/postgresCredentialStore';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { runMigrations } from '../src/migrations';
import type { CredentialStore } from '../src/credentials/types';
const HOUR_MS = 3_600_000;
const checkReplacement = async (store: CredentialStore) => {
	const expiresAt = Date.now() + HOUR_MS;
	await store.saveResetToken({
		email: 'User@example.com',
		expiresAt,
		tokenHash: 'older'
	});
	await store.saveResetToken({
		email: 'other@example.com',
		expiresAt,
		tokenHash: 'other'
	});
	await store.saveResetToken({
		email: 'user@EXAMPLE.com',
		expiresAt,
		tokenHash: 'newer'
	});
	expect(await store.consumeResetToken('older')).toBeUndefined();
	const attempts = await Promise.all([
		store.consumeResetToken('newer'),
		store.consumeResetToken('newer')
	]);
	expect(attempts.filter(Boolean)).toHaveLength(1);
	expect(attempts.find(Boolean)?.email).toBe('user@example.com');
	expect((await store.consumeResetToken('other'))?.email).toBe(
		'other@example.com'
	);
	await Promise.all(
		['concurrent-a', 'concurrent-b'].map((tokenHash) =>
			store.saveResetToken({
				email: 'user@example.com',
				expiresAt,
				tokenHash
			})
		)
	);
	const concurrent = await Promise.all(
		['concurrent-a', 'concurrent-b'].map((tokenHash) =>
			store.consumeResetToken(tokenHash)
		)
	);
	expect(concurrent.filter(Boolean)).toHaveLength(1);
	await store.saveResetToken({
		email: 'user@example.com',
		expiresAt: Date.now() - HOUR_MS,
		tokenHash: 'expired'
	});
	expect(await store.consumeResetToken('expired')).toBeUndefined();
};
test('in-memory resets replace older links and allow one consumer', async () => {
	await checkReplacement(createInMemoryCredentialStore());
});
test('Postgres migrates existing reset tokens and atomically replaces and consumes links', async () => {
	const client = new PGlite();
	try {
		await client.exec(`CREATE TABLE auth_credential_reset_tokens (email varchar(320) NOT NULL, expires_at_ms bigint NOT NULL, token_hash varchar(255) PRIMARY KEY);
   INSERT INTO auth_credential_reset_tokens VALUES ('duplicate@example.com', 9999999999999, 'legacy-a'), ('duplicate@example.com', 9999999999999, 'legacy-b'), ('single@example.com', 9999999999999, 'legacy-single');`);
		const migrate = () =>
			runMigrations({
				blocks: ['credentials'],
				client: {
					query: async (text, values) => ({
						rows: values
							? (await client.query(text, [...values])).rows
							: (await client.exec(text)).flatMap(
									(result) => result.rows
								)
					})
				},
				log: () => undefined
			});
		await migrate();
		await migrate();
		const store = createPostgresCredentialStore(drizzle({ client }));
		expect(await store.consumeResetToken('legacy-a')).toBeUndefined();
		expect(await store.consumeResetToken('legacy-b')).toBeUndefined();
		expect((await store.consumeResetToken('legacy-single'))?.email).toBe(
			'single@example.com'
		);
		await checkReplacement(store);
	} finally {
		await client.close();
	}
});
