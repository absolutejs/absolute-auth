import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { tablesToInitSql } from '../src/migrations/generate';
import {
	createPostgresWebAuthnChallengeStore,
	webauthnChallengesTable
} from '../src/webauthn/challengeStore';
import {
	createPostgresWebAuthnCredentialStore,
	webauthnCredentialsTable
} from '../src/webauthn/postgresWebAuthnCredentialStore';

const databaseUrl = process.env.AUTH_TEST_DATABASE_URL?.replace(
	'-pooler.',
	'.'
);
const postgresTest = databaseUrl ? test : test.skip;
postgresTest(
	'Postgres passkey records atomically consume and preserve credential ownership',
	async () => {
		if (!databaseUrl) throw new Error('Test database required');
		const schema = `passkey_test_${crypto.randomUUID().replaceAll('-', '')}`;
		const admin = new SQL(databaseUrl, { max: 1 });
		const connections: SQL[] = [];
		try {
			await admin.unsafe(`CREATE SCHEMA ${schema}`);
			await Promise.all(
				Array.from({ length: 4 }, async () => {
					const connection = new SQL(databaseUrl, { max: 1 });
					connections.push(connection);
					await connection.unsafe(`SET search_path TO ${schema}`);
				})
			);
			const [firstConnection] = connections;
			if (!firstConnection) throw new Error('Missing test connection');
			await firstConnection.unsafe(
				tablesToInitSql([
					webauthnChallengesTable,
					webauthnCredentialsTable
				])
			);
			const stores = connections.map((sql) =>
				createPostgresWebAuthnChallengeStore(drizzle({ client: sql }))
			);
			const [firstStore, secondStore] = stores;
			if (!firstStore || !secondStore)
				throw new Error('Missing test stores');
			const record = {
				challenge: 'public-challenge',
				expiresAt: 200,
				id: 'ceremony',
				purpose: 'approval' as const,
				sessionId: 'session',
				userId: 'alice'
			};
			await firstStore.save(record);
			expect(
				await secondStore.consume({
					...record,
					now: 100,
					userId: 'bob'
				})
			).toBeUndefined();
			const consumed = await Promise.all(
				stores.map((store) => store.consume({ ...record, now: 100 }))
			);
			expect(consumed.filter(Boolean)).toHaveLength(1);
			expect(
				await firstStore.consume({ ...record, now: 100 })
			).toBeUndefined();
			await firstStore.save({ ...record, id: 'expired' });
			expect(
				await secondStore.consume({
					...record,
					id: 'expired',
					now: 200
				})
			).toBeUndefined();
			const credentials = createPostgresWebAuthnCredentialStore(
				drizzle({ client: firstConnection })
			);
			const original = {
				counter: 5,
				createdAt: 100,
				credentialId: 'credential',
				publicKey: 'public-key',
				userId: 'alice'
			};
			await credentials.saveCredential(original);
			await expect(
				credentials.saveCredential({ ...original, userId: 'bob' })
			).rejects.toThrow();
			await expect(
				credentials.saveCredential({ ...original, publicKey: 'other' })
			).rejects.toThrow();
			await expect(
				credentials.saveCredential({ ...original, counter: 4 })
			).rejects.toThrow();
			await credentials.saveCredential({ ...original, counter: 6 });
			expect(
				(await credentials.getCredential('credential'))?.counter
			).toBe(6);
		} finally {
			await Promise.all(connections.map((sql) => sql.close()));
			await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
			await admin.close();
		}
	},
	30000
);
