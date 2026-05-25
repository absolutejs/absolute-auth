// Tenancy primitive. `organizationId` is a plain, consumer-owned identifier — the
// package stays unopinionated about org/role schemas (the consumer owns those via
// hooks). It is threaded (optionally) into SSO connections, SCIM tokens, and audit
// events so those can be scoped per organization without the package assuming a
// tenancy model. Sessions remain org-agnostic until SSO populates this field.

export type OrganizationId = string;

export type WithOrganization<Resource> = Resource & {
	organizationId?: OrganizationId;
};

export const hasOrganizationScope = (value: {
	organizationId?: OrganizationId;
}): value is { organizationId: OrganizationId } =>
	typeof value.organizationId === 'string' && value.organizationId.length > 0;
