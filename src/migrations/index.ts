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
	oauthRefreshTokensTable
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

// Additive TOTP-lockout column for the `mfa` block. Tracks consecutive failed TOTP/backup-code
// verifications at the login challenge, independent of the first-factor (password) lockout.
// Fresh installs get it via `0001_init`; this brings older tables up to date. Idempotent.
const mfaTotpLockoutMigration: Migration = {
	id: '0003_totp_lockout',
	sql: 'ALTER TABLE "auth_mfa_enrollments" ADD COLUMN IF NOT EXISTS "totp_failed_attempts" smallint NOT NULL DEFAULT 0;'
};

const oidcResourceAudienceMigration: Migration = {
	id: '0002_resource_audience',
	sql: [
		'ALTER TABLE "auth_oauth_codes" ADD COLUMN IF NOT EXISTS "audience" varchar(2048);',
		'ALTER TABLE "auth_oauth_refresh_tokens" ADD COLUMN IF NOT EXISTS "audience" varchar(2048);'
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
	credentials: initMigration('credentials', [
		credentialsTable,
		credentialResetTokensTable,
		credentialVerificationTokensTable
	]),
	fga: initMigration('fga', [warrantsTable]),
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
			mfaTotpLockoutMigration
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
				oauthRefreshTokensTable
			]).migrations,
			oidcResourceAudienceMigration
		]
	},
	organizations: initMigration('organizations', [
		organizationsTable,
		organizationMembershipsTable,
		organizationInvitationsTable
	]),
	passwordless: initMigration('passwordless', [passwordlessTokensTable]),
	portal: initMigration('portal', [setupSessionsTable]),
	roles: initMigration('roles', [rolesTable]),
	scim: initMigration('scim', [scimTokensTable]),
	sessions: initMigration('sessions', [
		authSessionsTable,
		authUnregisteredSessionsTable
	]),
	sso: initMigration('sso', [ssoConnectionsTable, samlServiceProvidersTable]),
	vault: initMigration('vault', [vaultEntriesTable]),
	vc: initMigration('vc', [
		vcCredentialOffersTable,
		vcCredentialNoncesTable,
		vcPresentationRequestsTable
	]),
	webauthn: initMigration('webauthn', [webauthnCredentialsTable]),
	webhooks: initMigration('webhooks', [webhookDeliveriesTable])
};

export { runMigrations } from './runner';
export type { Migration, BlockMigrations } from './types';
