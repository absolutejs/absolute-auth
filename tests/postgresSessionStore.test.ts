import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createPostgresAuthSessionStore } from '../src/session/neonStore';
import {
	createPostgresCredentialStore,
	credentialsTable
} from '../src/credentials/postgresCredentialStore';
import { runMigrations } from '../src/migrations';
import { isUserSessionId } from '../src/typeGuards';

const SESSION_TTL_MS = 60_000;
const url = process.env['AUTH_POSTGRES_TEST_URL'];
const decodeUser = (value: unknown) => {
	if (typeof value !== 'object' || value === null)
		throw new Error('Invalid session user');
	const id: unknown = Reflect.get(value, 'id');
	const email: unknown = Reflect.get(value, 'email');
	if (typeof id !== 'string' || typeof email !== 'string')
		throw new Error('Invalid session user');

	return { email, id };
};
test.skipIf(!url)(
	'Postgres credentials and sessions survive closing and reopening the driver',
	async () => {
		if (!url) throw new Error('AUTH_POSTGRES_TEST_URL is required');
		const migrationClient = new SQL({ max: 1, prepare: false, url });
		const first = new SQL({ max: 1, url });
		const id = crypto.randomUUID();
		if (!isUserSessionId(id)) throw new Error('Expected a session id');
		const user = {
			email: `durable-${crypto.randomUUID()}@example.invalid`,
			id: crypto.randomUUID()
		};
		const expiresAt = Date.now() + SESSION_TTL_MS;
		try {
			await runMigrations({
				blocks: ['sessions', 'credentials'],
				client: {
					query: async (text, values) => ({
						rows: await migrationClient.unsafe(
							text,
							values ? [...values] : []
						)
					})
				},
				log: () => undefined
			});
			const db = drizzle({ client: first });
			await createPostgresAuthSessionStore(db, decodeUser).setSession(
				id,
				{
					authenticatedAt: Date.now(),
					expiresAt,
					signInMethod: 'passkey',
					user,
					userAgent: 'Mozilla/5.0 (Macintosh) Safari/605'
				}
			);
			await createPostgresCredentialStore(db).saveCredential({
				createdAt: Date.now(),
				email: user.email,
				emailVerified: false,
				passwordHash: 'synthetic-library-hash',
				status: 'active',
				updatedAt: Date.now(),
				userId: user.id
			});
		} finally {
			await first.close();
			await migrationClient.close();
		}
		const second = new SQL(url);
		try {
			const db = drizzle({ client: second });
			const sessions = createPostgresAuthSessionStore(db, decodeUser);
			const stored = await sessions.getSession(id);
			expect(stored?.user).toEqual(user);
			expect(stored?.signInMethod).toBe('passkey');
			expect(stored?.userAgent).toBe(
				'Mozilla/5.0 (Macintosh) Safari/605'
			);
			expect(
				(
					await createPostgresCredentialStore(
						db
					).getCredentialByEmail(user.email)
				)?.userId
			).toBe(user.id);
			await sessions.removeSession(id);
			expect(await sessions.getSession(id)).toBeUndefined();
			await db
				.delete(credentialsTable)
				.where(eq(credentialsTable.email, user.email));
		} finally {
			await second.close();
		}
	}
);
