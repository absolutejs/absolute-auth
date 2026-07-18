import { SQL } from 'bun';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
	agentDelegationsTable,
	agentIdentityRegistrationsTable,
	agentRegistrationsTable,
	createPostgresAgentDelegationStore,
	createPostgresAgentIdentityRegistrationStore,
	createPostgresAgentRegistrationStore
} from '../src/agents/postgresStores';

const databaseUrl =
	process.env.AUTH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const MINUTE_MS = 60_000;

describe.skipIf(!databaseUrl)('Postgres agent stores', () => {
	test('round-trips typed JSON through the Bun SQL driver', async () => {
		if (!databaseUrl) throw new Error('A database URL is required');
		const client = new SQL({ max: 1, url: databaseUrl });
		const db = drizzle({ client });
		const agentId = `auth-store-test-${crypto.randomUUID()}`;
		const delegationId = crypto.randomUUID();
		const registrationId = crypto.randomUUID();
		const now = Date.now();
		const delegations = createPostgresAgentDelegationStore(db);
		const identities = createPostgresAgentIdentityRegistrationStore(db);
		const registrations = createPostgresAgentRegistrationStore(db);

		try {
			await registrations.saveRegistration({
				agentId,
				allowedScopes: ['a2a:owner:read', 'mcp:owner:read'],
				createdAt: now,
				metadata: { environment: 'test' },
				name: 'Bun SQL test agent',
				status: 'active',
				updatedAt: now
			});
			await delegations.saveDelegation({
				agentId,
				authorizationDetails: [{ type: 'project', value: 'project-1' }],
				createdAt: now,
				delegationId,
				scopes: ['a2a:owner:read'],
				status: 'active',
				updatedAt: now,
				userId: crypto.randomUUID()
			});
			expect(
				await identities.create({
					agentId,
					claimAttempt: {
						attempts: 1,
						email: 'agent@example.test',
						expiresAt: now + MINUTE_MS,
						tokenHash: crypto.randomUUID(),
						userCodeHash: crypto.randomUUID()
					},
					claimExpiresAt: now + MINUTE_MS,
					claimTokenHash: crypto.randomUUID(),
					createdAt: now,
					expiresAt: now + MINUTE_MS,
					kind: 'anonymous',
					registrationId,
					status: 'pending',
					updatedAt: now,
					version: 1
				})
			).toBe(true);

			expect(await registrations.findByAgentId(agentId)).toMatchObject({
				allowedScopes: ['a2a:owner:read', 'mcp:owner:read'],
				metadata: { environment: 'test' }
			});
			expect(
				await delegations.findByDelegationId(delegationId)
			).toMatchObject({
				authorizationDetails: [
					{ type: 'project', value: 'project-1' }
				],
				scopes: ['a2a:owner:read']
			});
			expect(
				await identities.findByRegistrationId(registrationId)
			).toMatchObject({
				claimAttempt: {
					attempts: 1,
					email: 'agent@example.test'
				}
			});
		} finally {
			await db
				.delete(agentDelegationsTable)
				.where(eq(agentDelegationsTable.agent_id, agentId));
			await db
				.delete(agentIdentityRegistrationsTable)
				.where(eq(agentIdentityRegistrationsTable.agent_id, agentId));
			await db
				.delete(agentRegistrationsTable)
				.where(eq(agentRegistrationsTable.agent_id, agentId));
			await client.close();
		}
	});
});
