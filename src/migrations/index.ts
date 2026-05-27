// Single export of every block's migrations. Consumers pick which blocks they enabled
// in `auth()` and pass that subset to `runMigrations({ blocks: [...] })`, or omit `blocks`
// to apply every migration the package ships. Adding a new block's migrations: import its
// tables here + add to the `blockMigrations` map.

import { knownDevicesTable, loginHistoryTable } from '../adaptive/postgresStores';
import {
	accessTokensTable,
	apiClientsTable,
	apiKeysTable
} from '../apikeys/postgresStores';
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
import type { BlockMigrations } from './types';

export type BlockName =
	| 'adaptive'
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

const initMigration = (block: BlockName, tables: Parameters<typeof tablesToInitSql>[0]): BlockMigrations => ({
	block,
	migrations: [{ id: '0001_init', sql: tablesToInitSql(tables) }]
});

export const blockMigrations: Record<BlockName, BlockMigrations> = {
	adaptive: initMigration('adaptive', [knownDevicesTable, loginHistoryTable]),
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
	mfa: initMigration('mfa', [mfaEnrollmentsTable]),
	oidc: initMigration('oidc', [
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
	]),
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
