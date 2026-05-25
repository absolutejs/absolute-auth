import { generateSecureToken, hashToken } from '../crypto';
import type { OrganizationId } from '../tenancy';
import type { RouteString } from '../types';
import type {
	ScimFilter,
	ScimGroup,
	ScimGroupInput,
	ScimToken,
	ScimTokenStore,
	ScimUser,
	ScimUserInput
} from './types';

export const DEFAULT_SCIM_ROUTE = '/scim/v2';
const SCIM_TOKEN_BYTES = 32;
const BEARER_PREFIX = 'Bearer ';

// SCIM 2.0 auto-provisioning (the directory-sync half of enterprise SSO). The package owns the
// SCIM protocol + per-org bearer-token auth; the consumer owns its user table through these
// mapping hooks, exactly like the OAuth / credentials / SSO surfaces.
export type ScimConfig = {
	// Group hooks are optional — when omitted, the `/Groups` routes respond 501 Not Implemented.
	getScimGroup?: (context: {
		id: string;
		organizationId: OrganizationId;
	}) => ScimGroup | undefined | Promise<ScimGroup | undefined>;
	getScimUser: (context: {
		id: string;
		organizationId: OrganizationId;
	}) => ScimUser | undefined | Promise<ScimUser | undefined>;
	listScimGroups?: (context: {
		filter?: ScimFilter;
		organizationId: OrganizationId;
	}) => ScimGroup[] | Promise<ScimGroup[]>;
	listScimUsers: (context: {
		filter?: ScimFilter;
		organizationId: OrganizationId;
	}) => ScimUser[] | Promise<ScimUser[]>;
	onScimGroupCreate?: (context: {
		input: ScimGroupInput;
		organizationId: OrganizationId;
	}) => ScimGroup | Promise<ScimGroup>;
	onScimGroupDelete?: (context: {
		id: string;
		organizationId: OrganizationId;
	}) => void | Promise<void>;
	// PUT (full replace) and PATCH (member add/remove + displayName) both land here.
	onScimGroupReplace?: (context: {
		id: string;
		input: ScimGroupInput;
		organizationId: OrganizationId;
	}) => ScimGroup | undefined | Promise<ScimGroup | undefined>;
	onScimUserCreate: (context: {
		input: ScimUserInput;
		organizationId: OrganizationId;
	}) => ScimUser | Promise<ScimUser>;
	// SCIM DELETE — the IdP deprovisions the user (consumer decides hard-delete vs deactivate).
	onScimUserDeactivate: (context: {
		id: string;
		organizationId: OrganizationId;
	}) => void | Promise<void>;
	// PUT (full replace) and PATCH (merged) both land here; returns undefined for unknown ids.
	onScimUserReplace: (context: {
		id: string;
		input: ScimUserInput;
		organizationId: OrganizationId;
	}) => ScimUser | undefined | Promise<ScimUser | undefined>;
	scimRoute?: RouteString;
	scimTokenStore: ScimTokenStore;
};

// Mint a per-org SCIM bearer token. The plaintext is returned once (configure it in the IdP);
// only its hash is persisted.
export const createScimToken = async (
	scimTokenStore: ScimTokenStore,
	organizationId: OrganizationId
) => {
	const token = generateSecureToken(SCIM_TOKEN_BYTES);
	const record: ScimToken = {
		createdAt: Date.now(),
		hashedToken: await hashToken(token),
		organizationId,
		tokenId: crypto.randomUUID()
	};
	await scimTokenStore.saveToken(record);

	return { token, tokenId: record.tokenId };
};

// Resolve the organization for an incoming SCIM request's `Authorization: Bearer …` header,
// or undefined when the header is missing / malformed / unknown.
export const resolveScimOrganization = async (
	scimTokenStore: ScimTokenStore,
	authorization: string | undefined
) => {
	if (
		authorization === undefined ||
		!authorization.startsWith(BEARER_PREFIX)
	) {
		return undefined;
	}

	const token = authorization.slice(BEARER_PREFIX.length).trim();
	if (token.length === 0) return undefined;

	const record = await scimTokenStore.findByHashedToken(
		await hashToken(token)
	);

	return record?.organizationId;
};
