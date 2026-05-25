import type { OAuth2TokenResponse, OIDCIdTokenClaims } from 'citra';
import { MILLISECONDS_IN_A_DAY } from '../constants';
import type { OrganizationId } from '../tenancy';
import type { RouteString, UserSessionId } from '../types';
import type {
	OidcConnection,
	SamlConnection,
	SSOConnectionStore
} from './types';

export const DEFAULT_SSO_ROUTE = '/sso';
export const DEFAULT_SSO_SESSION_TTL_MS = MILLISECONDS_IN_A_DAY;

// The verified result of a SAML Response, produced by the consumer's SamlAdapter after it has
// validated the assertion's XML signature against the IdP's certificate.
export type SamlProfile = {
	attributes: Record<string, unknown>;
	email?: string;
	nameId: string;
	sessionIndex?: string;
};

type SamlAuthorizeRequest = {
	acsUrl: string;
	connection: SamlConnection;
	relayState?: string;
};

type SamlAssertionRequest = {
	acsUrl: string;
	connection: SamlConnection;
	relayState?: string;
	samlResponse: string;
};

type SamlMetadataRequest = {
	acsUrl: string;
	connection: SamlConnection;
};

// SAML signature validation and XML handling are a security footgun, so the package never
// bundles a SAML library: the consumer supplies an adapter wrapping a vetted dependency
// (e.g. `@node-saml/node-saml`). The package owns the route wiring, cookies, and session
// minting; the adapter owns the XML/crypto. `acsUrl` is the package-derived Assertion
// Consumer Service URL for the connection's `/acs` route.
export type SamlAdapter = {
	createAuthorizationUrl: (
		request: SamlAuthorizeRequest
	) => Promise<string> | string;
	getServiceProviderMetadata: (
		request: SamlMetadataRequest
	) => Promise<string> | string;
	validateAssertion: (request: SamlAssertionRequest) => Promise<SamlProfile>;
};

type SsoIdentityBase = {
	email?: string;
	organizationId: OrganizationId;
	// OIDC `sub` or SAML `nameId` — the stable subject the consumer keys its user on.
	sub: string;
};

export type OidcSsoIdentity = SsoIdentityBase & {
	claims: OIDCIdTokenClaims;
	connection: OidcConnection;
	protocol: 'oidc';
	tokenResponse: OAuth2TokenResponse;
};

export type SamlSsoIdentity = SsoIdentityBase & {
	attributes: Record<string, unknown>;
	connection: SamlConnection;
	protocol: 'saml';
	sessionIndex?: string;
};

// The verified, normalized result of an SSO sign-in (OIDC or SAML) handed to the consumer's
// `getSsoUser` hook — the consumer owns the user table and maps this identity to its own user
// (creating one on first sign-in), discriminating on `protocol`.
export type SsoIdentity = OidcSsoIdentity | SamlSsoIdentity;

// Per-organization SSO (the WorkOS-style model). Additive and optional, mirroring the OAuth
// and credentials config surfaces. `getSsoUser` resolves the identity to a user (throw to
// reject); the route then mints the same `SessionData<UserType>` as every other flow. OIDC is
// always available; SAML routes mount only when a `samlAdapter` is supplied.
export type SSOConfig<UserType> = {
	getSsoUser: (identity: SsoIdentity) => Promise<UserType> | UserType;
	onSsoCallbackError?: (context: {
		error: unknown;
		organizationId: string;
	}) => void | Promise<void>;
	onSsoCallbackSuccess?: (context: {
		identity: SsoIdentity;
		user: UserType;
		userSessionId: UserSessionId;
	}) => void | Promise<void>;
	samlAdapter?: SamlAdapter;
	sessionDurationMs?: number;
	ssoConnectionStore: SSOConnectionStore;
	ssoRoute?: RouteString;
};
