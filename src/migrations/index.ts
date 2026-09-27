import { webauthnChallengesTable } from '../webauthn/challengeStore';
// Single export of every block's migrations. Consumers pick which blocks they enabled
// in `auth()` and pass that subset to `runMigrations({ blocks: [...] })`, or omit `blocks`
// to apply every migration the package ships. Adding a new block's migrations: import its
// tables here + add to the `blockMigrations` map.

import {
	knownDevicesTable,
	loginHistoryTable
} from '../adaptive/postgresStores';
import {
	accessTokensTable,
	apiClientsTable,
	apiKeysTable
} from '../apikeys/postgresStores';
import {
	agentDelegationsTable,
	agentIdentityRegistrationsTable,
	agentRegistrationsTable
} from '../agents/postgresStores';
import { auditEventsTable } from '../audit/postgresAuditStore';
import {
	credentialResetTokensTable,
	credentialVerificationTokensTable,
	credentialsTable
} from '../credentials/postgresCredentialStore';
import { warrantsTable } from '../fga/postgresStores';
import {
	linkedProviderBindingsTable,
	linkedProviderGrantsTable
} from '../linkedProviders/neonStores';
import { lockoutsTable } from '../lockout/postgresLockoutStore';
import { mfaEnrollmentsTable } from '../mfa/postgresMfaStore';
import {
	oauthBackchannelAuthRequestsTable,
	oauthClientAssertionJtisTable,
	oauthClientRegistrationTokensTable,
	oauthClientsTable,
	oauthCodesTable,
	oauthDeviceAuthorizationsTable,
	oauthInitialAccessTokensTable,
	oauthLogoutDeliveriesTable,
	oauthPushedAuthorizationRequestsTable,
	oauthRefreshTokensTable,
	oauthSocketTicketsTable
} from '../oidc/postgresStores';
import {
	organizationInvitationsTable,
	organizationMembershipsTable,
	organizationsTable
} from '../organizations/postgresOrganizationStore';
import { passwordlessTokensTable } from '../passwordless/postgresPasswordlessTokenStore';
import { setupSessionsTable } from '../portal/postgresSetupSessionStore';
import { rolesTable } from '../roles/postgresRoleStore';
import { scimTokensTable } from '../scim/postgresScimTokenStore';
import {
	authSessionsTable,
	authUnregisteredSessionsTable
} from '../session/neonStore';
import { samlServiceProvidersTable } from '../sso/postgresSamlServiceProviderStore';
import { ssoConnectionsTable } from '../sso/postgresSsoConnectionStore';
import {
	vcCredentialNoncesTable,
	vcCredentialOffersTable,
	vcPresentationRequestsTable
} from '../vc/postgresVcStores';
import { vaultEntriesTable } from '../vault/postgresVaultStore';
import { webauthnCredentialsTable } from '../webauthn/postgresWebAuthnCredentialStore';
import { authIdentitiesTable } from '../identities/postgresIdentityStore';
import { webhookDeliveriesTable } from '../webhooks/postgresStore';
import { tablesToInitSql } from './generate';
import type { BlockMigrations, Migration } from './types';

export type BlockName =
	| 'adaptive'
	| 'agents'
	| 'apikeys'
	| 'audit'
	| 'credentials'
	| 'fga'
	| 'identities'
	| 'linkedProviders'
	| 'lockout'
	| 'mfa'
	| 'oidc'
	| 'organizations'
	| 'passwordless'
	| 'portal'
	| 'roles'
	| 'scim'
	| 'sessions'
	| 'sso'
	| 'vault'
	| 'vc'
	| 'webauthn'
	| 'webhooks';

const initMigration = (
	block: BlockName,
	tables: Parameters<typeof tablesToInitSql>[0]
): BlockMigrations => ({
	block,
	migrations: [{ id: '0001_init', sql: tablesToInitSql(tables) }]
});

// Additive SMS-factor columns for the `mfa` block. Fresh installs already get these via the
// generated `0001_init` CREATE TABLE; this `ALTER ... ADD COLUMN IF NOT EXISTS` brings tables
// created before the SMS factor up to date. Idempotent — safe to re-run.
const mfaSmsColumnsMigration: Migration = {
	id: '0002_sms_factor',
	sql: [
		'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "sms_phone" varchar(20);',
		'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "sms_verified" boolean NOT NULL DEFAULT false;',
		'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "sms_pending_code_hash" text;',
		'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "sms_pending_code_expires_at_ms" bigint;',
		'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "sms_failed_attempts" smallint NOT NULL DEFAULT 0;'
	].join('\n')
};

const credentialDeferredUserMigration: Migration = {
	id: '0002_deferred_user_creation',
	sql: 'ALTER TABLE "auth_credentials" ADD COLUMN IF NOT EXISTS "registration_data" jsonb;'
};

// Additive TOTP-lockout column for the `mfa` block. Tracks consecutive failed TOTP/backup-code
// verifications at the login challenge, independent of the first-factor (password) lockout.
// Fresh installs get it via `0001_init`; this brings older tables up to date. Idempotent.
const mfaTotpLockoutMigration: Migration = {
	id: '0003_totp_lockout',
	sql: 'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "totp_failed_attempts" smallint NOT NULL DEFAULT 0;'
};

const mfaSmsDeliveryPolicyMigration: Migration = {
	id: '0004_sms_delivery_policy',
	sql: [
		'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "sms_code_sent_at_ms" bigint;',
		'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "sms_pending_purpose" text;',
		'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "sms_provider_reference" text;'
	].join('\n')
};

const mfaSmsAtomicChallengeMigration: Migration = {
	id: '0005_sms_atomic_challenge',
	sql: 'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "sms_challenge_id" text;'
};

const mfaMultipleFactorsMigration: Migration = {
	id: '0006_multiple_factors',
	sql: [
		'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "mfa_factors" jsonb;',
		'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "sms_pending_factor_id" text;'
	].join('\n')
};

const oidcResourceAudienceMigration: Migration = {
	id: '0002_resource_audience',
	sql: [
		'ALTER TABLE "auth_oauth_codes" ADD COLUMN IF NOT EXISTS "audience" varchar(2048);',
		'ALTER TABLE "auth_oauth_refresh_tokens" ADD COLUMN IF NOT EXISTS "audience" varchar(2048);'
	].join('\n')
};

const oidcRefreshTokenFamiliesMigration: Migration = {
	id: '0003_refresh_token_families',
	sql: [
		'ALTER TABLE "auth_oauth_refresh_tokens" ADD COLUMN IF NOT EXISTS "family_id" varchar(255);',
		'UPDATE "auth_oauth_refresh_tokens" SET "family_id" = "token_hash" WHERE "family_id" IS NULL;',
		'ALTER TABLE "auth_oauth_refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;',
		'ALTER TABLE "auth_oauth_refresh_tokens" ADD COLUMN IF NOT EXISTS "consumed_token_hashes" text[] NOT NULL DEFAULT ARRAY[]::text[];',
		'ALTER TABLE "auth_oauth_refresh_tokens" ADD COLUMN IF NOT EXISTS "revoked_at_ms" bigint;'
	].join('\n')
};

const oidcSocketTicketsMigration: Migration = {
	id: '0004_socket_tickets',
	sql: tablesToInitSql([oauthSocketTicketsTable])
};

const oidcDeviceAudienceMigration: Migration = {
	id: '0005_device_resource_audience',
	sql: 'ALTER TABLE "auth_oauth_device_authorizations" ADD COLUMN IF NOT EXISTS "audience" varchar(2048);'
};

// Optional invitee name and personal note on invitations.
const organizationInvitationDetailsMigration: Migration = {
	id: '0002_invitation_details',
	sql: [
		'ALTER TABLE "auth_organization_invitations" ADD COLUMN IF NOT EXISTS "invitee_name" varchar(200);',
		'ALTER TABLE "auth_organization_invitations" ADD COLUMN IF NOT EXISTS "message" text;'
	].join('\n')
};

// Per-family lookups back device inventories and per-request revocation checks.
const oidcRefreshFamilyIndexMigration: Migration = {
	id: '0006_refresh_token_family_index',
	sql: [
		'CREATE INDEX IF NOT EXISTS "auth_oauth_refresh_tokens_family_id_idx" ON "auth_oauth_refresh_tokens" ("family_id");',
		'CREATE INDEX IF NOT EXISTS "auth_oauth_refresh_tokens_user_client_idx" ON "auth_oauth_refresh_tokens" ("user_id", "client_id");'
	].join('\n')
};

const sessionOAuthSubjectMigration: Migration = {
	id: '0002_oauth_subject',
	sql: [
		'ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "oauth_subject_json" jsonb;',
		'ALTER TABLE "auth_unregistered_sessions" ADD COLUMN IF NOT EXISTS "oauth_subject_json" jsonb;'
	].join('\n')
};

export const blockMigrations: Record<BlockName, BlockMigrations> = {
	adaptive: initMigration('adaptive', [knownDevicesTable, loginHistoryTable]),
	agents: {
		block: 'agents',
		migrations: [
			...initMigration('agents', [
				agentRegistrationsTable,
				agentDelegationsTable,
				agentIdentityRegistrationsTable
			]).migrations,
			{
				id: '0002_identity_registration',
				sql: tablesToInitSql([agentIdentityRegistrationsTable])
			}
		]
	},
	apikeys: initMigration('apikeys', [
		accessTokensTable,
		apiClientsTable,
		apiKeysTable
	]),
	audit: initMigration('audit', [auditEventsTable]),
	credentials: {
		block: 'credentials',
		migrations: [
			...initMigration('credentials', [
				credentialsTable,
				credentialResetTokensTable,
				credentialVerificationTokensTable
			]).migrations,
			credentialDeferredUserMigration
		]
	},
	fga: initMigration('fga', [warrantsTable]),
	identities: {
		block: 'identities',
		migrations: [
			...initMigration('identities', [authIdentitiesTable]).migrations,
			{
				// Tables created by app code before this block existed lack these; the
				// unique index is what keeps one provider account on one user.
				id: '0002_last_used_and_unique_pair',
				sql: [
					'ALTER TABLE "auth_identities" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp;',
					'CREATE UNIQUE INDEX IF NOT EXISTS "auth_identities_provider_subject_idx" ON "auth_identities" ("auth_provider", "provider_subject");',
					'CREATE INDEX IF NOT EXISTS "auth_identities_user_sub_idx" ON "auth_identities" ("user_sub");'
				].join('\n')
			}
		]
	},
	linkedProviders: initMigration('linkedProviders', [
		linkedProviderBindingsTable,
		linkedProviderGrantsTable
	]),
	lockout: initMigration('lockout', [lockoutsTable]),
	mfa: {
		block: 'mfa',
		migrations: [
			...initMigration('mfa', [mfaEnrollmentsTable]).migrations,
			mfaSmsColumnsMigration,
			mfaTotpLockoutMigration,
			mfaSmsDeliveryPolicyMigration,
			mfaSmsAtomicChallengeMigration,
			mfaMultipleFactorsMigration
		]
	},
	oidc: {
		block: 'oidc',
		migrations: [
			...initMigration('oidc', [
				oauthBackchannelAuthRequestsTable,
				oauthClientAssertionJtisTable,
				oauthClientRegistrationTokensTable,
				oauthClientsTable,
				oauthCodesTable,
				oauthDeviceAuthorizationsTable,
				oauthInitialAccessTokensTable,
				oauthLogoutDeliveriesTable,
				oauthPushedAuthorizationRequestsTable,
				oauthRefreshTokensTable,
				oauthSocketTicketsTable
			]).migrations,
			oidcResourceAudienceMigration,
			oidcRefreshTokenFamiliesMigration,
			oidcSocketTicketsMigration,
			oidcDeviceAudienceMigration,
			oidcRefreshFamilyIndexMigration
		]
	},
	organizations: {
		block: 'organizations',
		migrations: [
			...initMigration('organizations', [
				organizationsTable,
				organizationMembershipsTable,
				organizationInvitationsTable
			]).migrations,
			organizationInvitationDetailsMigration
		]
	},
	passwordless: initMigration('passwordless', [passwordlessTokensTable]),
	portal: initMigration('portal', [setupSessionsTable]),
	roles: initMigration('roles', [rolesTable]),
	scim: initMigration('scim', [scimTokensTable]),
	sessions: {
		block: 'sessions',
		migrations: [
			...initMigration('sessions', [
				authSessionsTable,
				authUnregisteredSessionsTable
			]).migrations,
			sessionOAuthSubjectMigration,
			{
				id: '0003_sign_in_device',
				sql: [
					'ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "sign_in_method" varchar(64);',
					'ALTER TABLE "auth_sessions" ADD COLUMN IF NOT EXISTS "user_agent" varchar(512);'
				].join('\n')
			}
		]
	},
	sso: initMigration('sso', [ssoConnectionsTable, samlServiceProvidersTable]),
	vault: initMigration('vault', [vaultEntriesTable]),
	vc: initMigration('vc', [
		vcCredentialOffersTable,
		vcCredentialNoncesTable,
		vcPresentationRequestsTable
	]),
	webauthn: {
		block: 'webauthn',
		migrations: [
			...initMigration('webauthn', [webauthnCredentialsTable]).migrations,
			{
				id: '0002_server_challenges',
				sql: tablesToInitSql([webauthnChallengesTable])
			},
			{
				id: '0003_credential_names',
				sql: 'ALTER TABLE "auth_webauthn_credentials" ADD COLUMN IF NOT EXISTS "name" varchar(100);'
			}
		]
	},
	webhooks: initMigration('webhooks', [webhookDeliveriesTable])
};

export { runMigrations } from './runner';
export type {
	MigrationClient,
	MigrationQueryResult,
	MigrationRunResult,
	RunMigrationsOptions
} from './runner';
export type { Migration, BlockMigrations } from './types';
