import type { OrganizationId } from '../tenancy';

// Per-organization SSO connection config (the WorkOS-style model): an org's IT connects
// their IdP once, then their users sign in through it. A connection is either OIDC
// (runtime/discovery-configured) or SAML 2.0; the type-specific config lives in `config`
// so it round-trips cleanly through a single jsonb column.

export type SSOConnectionType = 'oidc' | 'saml';

// OIDC is discovery-driven: only the issuer + client credentials are stored; the actual
// authorize/token/jwks endpoints are resolved at runtime from the issuer's
// /.well-known/openid-configuration.
export type OidcConnectionConfig = {
	clientId: string;
	clientSecret: string;
	issuer: string;
	scopes: string[];
};

// SAML stores the IdP's entity descriptor: where to send the AuthnRequest and the x509
// signing certificate used to validate the returned assertion.
export type SamlConnectionConfig = {
	idpEntityId: string;
	idpSloUrl?: string;
	idpSsoUrl: string;
	idpX509Cert: string;
};

type SSOConnectionBase = {
	connectionId: string;
	createdAt: number;
	enabled: boolean;
	organizationId: OrganizationId;
	updatedAt: number;
};

export type OidcConnection = SSOConnectionBase & {
	config: OidcConnectionConfig;
	type: 'oidc';
};

export type SamlConnection = SSOConnectionBase & {
	config: SamlConnectionConfig;
	type: 'saml';
};

export type SSOConnection = OidcConnection | SamlConnection;

export type SSOConnectionStore = {
	deleteConnection: (connectionId: string) => Promise<void>;
	getConnection: (connectionId: string) => Promise<SSOConnection | undefined>;
	// Resolve the connection a sign-in should use for an org (enabled only, optionally
	// narrowed to a type). The login routes call this after domain->org routing.
	getConnectionByOrganization: (
		organizationId: OrganizationId,
		type?: SSOConnectionType
	) => Promise<SSOConnection | undefined>;
	// All connections for an org (including disabled) — for admin management.
	listConnectionsByOrganization: (
		organizationId: OrganizationId
	) => Promise<SSOConnection[]>;
	saveConnection: (connection: SSOConnection) => Promise<void>;
};
