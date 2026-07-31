import { SQL } from 'bun';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
	agentDelegationsTable,
	agentDelegationsBunSqlTable,
	agentIdentityRegistrationsTable,
	agentIdentityRegistrationsBunSqlTable,
	agentRegistrationsTable,
	agentRegistrationsBunSqlTable,
	createBunSqlDrizzleAgentDelegationStore,
	createBunSqlDrizzleAgentIdentityRegistrationStore,
	createBunSqlDrizzleAgentRegistrationStore,
	createDrizzleAgentDelegationStore,
	createPostgresAgentIdentityRegistrationStore,
	createPostgresAgentRegistrationStore
} from '../src/agents/postgresStores';

const databaseUrl =
	process.env.AUTH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const MINUTE_MS = 60_000;
const CONNECTION_ATTEMPTS = 8;
const RETRY_DELAY_MS = 500;
type OpenClient = (
	databaseUrl: string,
	prepare?: boolean,
	attempt?: number
) => Promise<SQL>;
const openClient: OpenClient = async (url, prepare = false, attempt = 1) => {
	const client = new SQL({ max: 1, prepare, url });
	try {
		await client`select 1`;

		return client;
	} catch (error) {
		await client.close().catch(() => undefined);
		if (attempt === CONNECTION_ATTEMPTS) throw error;
		await Bun.sleep(RETRY_DELAY_MS * attempt);

		return openClient(url, prepare, attempt + 1);
	}
};

describe.skipIf(!databaseUrl)('Postgres agent stores', () => {
	test('round-trips typed JSON through the Bun SQL driver', async () => {
		if (!databaseUrl) throw new Error('A database URL is required');
		const client = await openClient(databaseUrl);
		const db = drizzle({ client });
		const agentId = `auth-store-test-${crypto.randomUUID()}`;
		const delegationId = crypto.randomUUID();
		const registrationId = crypto.randomUUID();
		const now = Date.now();
		const delegations = createDrizzleAgentDelegationStore(db);
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
				authorizationDetails: [{ type: 'project', value: 'project-1' }],
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
			const shapes = await client`
				select jsonb_typeof(allowed_scopes) as allowed_scopes,
				       jsonb_typeof(metadata) as metadata
				from auth_agent_registrations
				where agent_id = ${agentId}
			`;
			const delegationShapes = await client`
				select jsonb_typeof(authorization_details) as authorization_details,
				       jsonb_typeof(scopes) as scopes
				from auth_agent_delegations
				where delegation_id = ${delegationId}
			`;
			const identityShapes = await client`
				select jsonb_typeof(claim_attempt) as claim_attempt
				from auth_agent_identity_registrations
				where registration_id = ${registrationId}
			`;
			expect(shapes[0]).toMatchObject({
				allowed_scopes: 'array',
				metadata: 'object'
			});
			expect(delegationShapes[0]).toMatchObject({
				authorization_details: 'array',
				scopes: 'array'
			});
			expect(identityShapes[0]).toMatchObject({
				claim_attempt: 'object'
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

	test('round-trips native JSON through prepared Bun SQL mappings', async () => {
		if (!databaseUrl) throw new Error('A database URL is required');
		const client = await openClient(databaseUrl, true);
		const db = drizzle({ client });
		const agentId = `auth-bun-sql-test-${crypto.randomUUID()}`;
		const delegationId = crypto.randomUUID();
		const registrationId = crypto.randomUUID();
		const now = Date.now();

		try {
			await createBunSqlDrizzleAgentRegistrationStore(
				db
			).saveRegistration({
				agentId,
				allowedScopes: ['a2a:owner:read'],
				createdAt: now,
				metadata: { environment: 'prepared-test' },
				name: 'Prepared Bun SQL test agent',
				status: 'active',
				updatedAt: now
			});
			await createBunSqlDrizzleAgentDelegationStore(db).saveDelegation({
				agentId,
				authorizationDetails: [
					{ type: 'project', value: 'synthetic-project' }
				],
				createdAt: now,
				delegationId,
				scopes: ['a2a:owner:read'],
				status: 'active',
				updatedAt: now,
				userId: crypto.randomUUID()
			});
			expect(
				await createBunSqlDrizzleAgentIdentityRegistrationStore(
					db
				).create({
					agentId,
					claimAttempt: {
						attempts: 1,
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

			const [shapes] = await client`
				select jsonb_typeof(reg.allowed_scopes) as allowed_scopes,
				       jsonb_typeof(reg.metadata) as metadata,
				       jsonb_typeof(del.authorization_details) as authorization_details,
				       jsonb_typeof(del.scopes) as scopes,
				       jsonb_typeof(identity.claim_attempt) as claim_attempt
				from auth_agent_registrations reg
				join auth_agent_delegations del on del.agent_id = reg.agent_id
				join auth_agent_identity_registrations identity on identity.agent_id = reg.agent_id
				where reg.agent_id = ${agentId}
			`;
			expect(shapes).toMatchObject({
				allowed_scopes: 'array',
				authorization_details: 'array',
				claim_attempt: 'object',
				metadata: 'object',
				scopes: 'array'
			});
		} finally {
			await db
				.delete(agentDelegationsBunSqlTable)
				.where(eq(agentDelegationsBunSqlTable.agent_id, agentId));
			await db
				.delete(agentIdentityRegistrationsBunSqlTable)
				.where(
					eq(agentIdentityRegistrationsBunSqlTable.agent_id, agentId)
				);
			await db
				.delete(agentRegistrationsBunSqlTable)
				.where(eq(agentRegistrationsBunSqlTable.agent_id, agentId));
			await client.close();
		}
	});
});
