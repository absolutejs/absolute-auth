import type { AuditEmitter } from '../audit/config';
import { MILLISECONDS_IN_A_DAY } from '../constants';
import type { ScimTokenStore } from '../scim/types';
import type { SSOConnectionStore, SSOConnectionType } from '../sso/types';
import type { OrganizationId } from '../tenancy';
import type { RouteString } from '../types';
import type { SetupCapability, SetupSessionStore } from './types';

const SETUP_TTL_DAYS = 3;

export const DEFAULT_PORTAL_ROUTE: RouteString = '/auth/portal';
export const DEFAULT_SETUP_SESSION_TTL_MS =
	MILLISECONDS_IN_A_DAY * SETUP_TTL_DAYS;

// Admin portal — the WorkOS "self-serve setup link" model, headless. The vendor mints a scoped
// setup link (`createSetupSession`) and hands it to a customer's IT admin; the admin's portal page
// (built in ANY framework — the contract is JSON) reads `GET {portalRoute}/session` for the
// service-provider URLs to enter into their IdP, then PUTs their SSO connection / POSTs a SCIM
// token. All portal routes authenticate with the setup token (Bearer), not a user session. The
// stores are the same ones the `sso` / `scim` blocks use, so configuration takes effect live.
export type PortalConfig = {
	setupSessionStore: SetupSessionStore;
	onScimTokenCreated?: (context: {
		organizationId: OrganizationId;
		tokenId: string;
	}) => void | Promise<void>;
	onSsoConnectionConfigured?: (context: {
		organizationId: OrganizationId;
		type: SSOConnectionType;
	}) => void | Promise<void>;
	portalRoute?: RouteString;
	// Defaults to DEFAULT_SCIM_ROUTE; used only to show the admin the correct SCIM base URL.
	scimRoute?: RouteString;
	// Required for the `scim` capability.
	scimTokenStore?: ScimTokenStore;
	// Required for the `sso_oidc` / `sso_saml` capabilities.
	ssoConnectionStore?: SSOConnectionStore;
	// Defaults to DEFAULT_SSO_ROUTE; used to derive the ACS / metadata / callback URLs shown.
	ssoRoute?: RouteString;
};

export type PortalRouteProps = PortalConfig & {
	emit?: AuditEmitter;
};

export type SetupSessionRequest = {
	capabilities: SetupCapability[];
	createdBy?: string;
	organizationId: OrganizationId;
	setupSessionDurationMs?: number;
	setupSessionStore: SetupSessionStore;
};
