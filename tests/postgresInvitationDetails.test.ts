import { SQL } from 'bun';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sql';
import { runMigrations, type MigrationClient } from '../src/migrations/runner';
import { createPostgresOrganizationStore } from '../src/organizations/postgresOrganizationStore';

const databaseUrl = process.env['MIGRATION_TEST_DATABASE_URL'];
const HOUR_MS = 3_600_000;

describe.skipIf(databaseUrl === undefined)(
	'Postgres invitation details',
	() => {
		test('round-trips the invitee name and personal note', async () => {
			if (databaseUrl === undefined)
				throw new Error('MIGRATION_TEST_DATABASE_URL is required');
			// Own database: the migration integration test expects a fresh journal.
			const admin = new SQL({ max: 1, prepare: false, url: databaseUrl });
			const database = `auth_invites_${crypto.randomUUID().replaceAll('-', '')}`;
			await admin`CREATE DATABASE ${admin(database)}`;
			const url = new URL(databaseUrl);
			url.pathname = `/${database}`;
			const sql = new SQL({
				max: 1,
				prepare: false,
				url: url.toString()
			});
			try {
				const client: MigrationClient = {
					query: async (text, values = []) => ({
						rows: Array.from(await sql.unsafe(text, [...values]))
					})
				};
				await runMigrations({
					blocks: ['organizations'],
					client,
					log: () => undefined
				});
				const store = createPostgresOrganizationStore(
					drizzle({ client: sql })
				);
				const now = Date.now();
				// Rows are written with SQL: the Bun SQL Drizzle adapter cannot bind the
				// jsonb roles column. Reads go through the store's row mapping.
				await sql`INSERT INTO auth_organization_invitations
					(invitation_id, organization_id, email, roles, state, token_hash,
					 created_at_ms, expires_at_ms, invitee_name, message)
					VALUES
					('invite-1', 'org-1', 'named@example.com', '["viewer"]'::jsonb, 'pending',
					 'hash-1', ${now}, ${now + HOUR_MS}, 'Pat Example', 'Welcome aboard'),
					('invite-2', 'org-1', 'plain@example.com', '["viewer"]'::jsonb, 'pending',
					 'hash-2', ${now}, ${now + HOUR_MS}, NULL, NULL)`;
				const listed =
					await store.listInvitationsByOrganization('org-1');
				const named = listed.find(
					(invite) => invite.invitationId === 'invite-1'
				);
				const plain = listed.find(
					(invite) => invite.invitationId === 'invite-2'
				);
				expect(named).toMatchObject({
					inviteeName: 'Pat Example',
					message: 'Welcome aboard'
				});
				expect(plain).not.toHaveProperty('inviteeName');
				expect(plain).not.toHaveProperty('message');
			} finally {
				await sql.close();
				await admin`DROP DATABASE IF EXISTS ${admin(database)}`;
				await admin.close();
			}
		});
	}
);
