import type { OrganizationId } from '../tenancy';

// What a setup link is allowed to configure. The vendor scopes each link when creating it.
export type SetupCapability = 'scim' | 'sso_oidc' | 'sso_saml';

// A scoped, time-boxed admin-portal session. The vendor mints one per customer org and hands the
// plaintext token to the customer's IT admin (via a link); the admin's browser then calls the
// portal endpoints with it as a Bearer token — no user account in our system required.
export type SetupSession = {
	capabilities: SetupCapability[];
	createdAt: number;
	// Optional id of the vendor user who generated the link (for audit).
	createdBy?: string;
	expiresAt: number;
	organizationId: OrganizationId;
	setupSessionId: string;
	// SHA-256 hash of the setup token; the plaintext is returned once at creation.
	tokenHash: string;
};

export type SetupSessionStore = {
	deleteSetupSession: (setupSessionId: string) => Promise<void>;
	getSetupSessionByTokenHash: (
		tokenHash: string
	) => Promise<SetupSession | undefined>;
	saveSetupSession: (session: SetupSession) => Promise<void>;
};
