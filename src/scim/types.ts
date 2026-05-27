import type { OrganizationId } from '../tenancy';

// A per-organization SCIM bearer token. Only the hash is stored; the plaintext is shown once at
// creation. The IdP (Okta / Azure AD / …) presents the plaintext as `Authorization: Bearer …`.
export type ScimToken = {
	createdAt: number;
	hashedToken: string;
	lastUsedAt?: number;
	organizationId: OrganizationId;
	tokenId: string;
};

export type ScimTokenStore = {
	deleteToken: (tokenId: string) => Promise<void>;
	findByHashedToken: (hashedToken: string) => Promise<ScimToken | undefined>;
	listTokens: (organizationId: OrganizationId) => Promise<ScimToken[]>;
	saveToken: (token: ScimToken) => Promise<void>;
};

// The package's normalized view of a SCIM User — the shape the consumer's mapping hooks read and
// return. The package serializes it to/from the SCIM 2.0 wire format (schemas, name, emails,
// meta, …) so the consumer never touches SCIM JSON. `custom` carries the bag produced by
// `ScimConfig.customAttributes.fromScim` so the consumer's hooks see one merged shape.
export type ScimUser = {
	active: boolean;
	custom?: Record<string, unknown>;
	displayName?: string;
	email?: string;
	externalId?: string;
	familyName?: string;
	givenName?: string;
	id: string;
	userName: string;
};

// A SCIM User to create or replace — `ScimUser` without the server-assigned `id`.
export type ScimUserInput = {
	active: boolean;
	custom?: Record<string, unknown>;
	displayName?: string;
	email?: string;
	externalId?: string;
	familyName?: string;
	givenName?: string;
	userName: string;
};

export type ScimGroupMember = {
	display?: string;
	value: string;
};

// The package's normalized view of a SCIM Group (membership keyed by the user's SCIM id).
export type ScimGroup = {
	displayName: string;
	externalId?: string;
	id: string;
	members: ScimGroupMember[];
};

// A SCIM Group to create or replace — `ScimGroup` without the server-assigned `id`.
export type ScimGroupInput = {
	displayName: string;
	externalId?: string;
	members: ScimGroupMember[];
};

// The common SCIM list filter Okta/Azure send, e.g. `userName eq "alice@acme.com"` or
// `displayName eq "Engineering"`.
export type ScimFilter = {
	attribute: string;
	value: string;
};
