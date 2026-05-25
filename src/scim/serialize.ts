import type { ScimUser, ScimUserFilter, ScimUserInput } from './types';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SPC_SCHEMA =
	'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
const SCIM_CONTENT_TYPE = 'application/scim+json';
const FILTER_MAX_RESULTS = 200;

const FILTER_PATTERN = /^\s*(\w[\w.]*)\s+eq\s+"([^"]*)"\s*$/u;

// Serialize the package's normalized user into the SCIM 2.0 User wire format.
export const toUserResource = (user: ScimUser, location: string) => {
	const resource: Record<string, unknown> = {
		active: user.active,
		id: user.id,
		meta: { location, resourceType: 'User' },
		schemas: [USER_SCHEMA],
		userName: user.userName
	};
	if (user.externalId !== undefined) resource.externalId = user.externalId;
	if (user.displayName !== undefined) resource.displayName = user.displayName;
	if (user.givenName !== undefined || user.familyName !== undefined) {
		resource.name = {
			familyName: user.familyName,
			givenName: user.givenName
		};
	}
	if (user.email !== undefined) {
		resource.emails = [{ primary: true, value: user.email }];
	}

	return resource;
};

const stringField = (source: unknown, field: string) => {
	if (typeof source !== 'object' || source === null) return undefined;
	const value = Reflect.get(source, field);

	return typeof value === 'string' ? value : undefined;
};

const primaryEmail = (emails: unknown) => {
	if (!Array.isArray(emails) || emails.length === 0) return undefined;
	const flagged = emails.find(
		(entry) =>
			typeof entry === 'object' &&
			entry !== null &&
			Reflect.get(entry, 'primary') === true
	);

	return stringField(flagged ?? emails[0], 'value');
};

// Parse an incoming SCIM User body into the normalized input the mapping hooks read.
export const parseUserInput = (body: unknown): ScimUserInput | undefined => {
	if (typeof body !== 'object' || body === null) return undefined;

	const userName = stringField(body, 'userName');
	if (userName === undefined || userName.length === 0) return undefined;

	const active = Reflect.get(body, 'active');
	const name = Reflect.get(body, 'name');

	return {
		active: typeof active === 'boolean' ? active : true,
		displayName: stringField(body, 'displayName'),
		email: primaryEmail(Reflect.get(body, 'emails')),
		externalId: stringField(body, 'externalId'),
		familyName: stringField(name, 'familyName'),
		givenName: stringField(name, 'givenName'),
		userName
	};
};

const applyValueObject = (target: ScimUserInput, value: object) => {
	const active = Reflect.get(value, 'active');
	if (typeof active === 'boolean') target.active = active;
	const userName = stringField(value, 'userName');
	if (userName !== undefined) target.userName = userName;
	const displayName = stringField(value, 'displayName');
	if (displayName !== undefined) target.displayName = displayName;
	const externalId = stringField(value, 'externalId');
	if (externalId !== undefined) target.externalId = externalId;
};

const applyPathValue = (
	target: ScimUserInput,
	path: string,
	value: unknown
) => {
	const key = path.toLowerCase();
	if (key === 'active' && typeof value === 'boolean') target.active = value;
	if (key === 'username' && typeof value === 'string')
		target.userName = value;
	if (key === 'displayname' && typeof value === 'string') {
		target.displayName = value;
	}
	if (key === 'externalid' && typeof value === 'string') {
		target.externalId = value;
	}
	if (key === 'name.givenname' && typeof value === 'string') {
		target.givenName = value;
	}
	if (key === 'name.familyname' && typeof value === 'string') {
		target.familyName = value;
	}
};

const applyOperation = (target: ScimUserInput, operation: unknown) => {
	if (typeof operation !== 'object' || operation === null) return;
	const op = Reflect.get(operation, 'op');
	if (typeof op === 'string' && op.toLowerCase() === 'remove') return;

	const path = Reflect.get(operation, 'path');
	const value = Reflect.get(operation, 'value');
	if (typeof path === 'string') {
		applyPathValue(target, path, value);

		return;
	}
	if (typeof value === 'object' && value !== null) {
		applyValueObject(target, value);
	}
};

// Merge a SCIM PatchOp body onto an existing user, producing the replacement input. Covers the
// `active` toggle (deprovisioning) and the common core attributes, in both path and value-object
// operation forms.
export const applyPatch = (user: ScimUser, body: unknown) => {
	const next: ScimUserInput = {
		active: user.active,
		displayName: user.displayName,
		email: user.email,
		externalId: user.externalId,
		familyName: user.familyName,
		givenName: user.givenName,
		userName: user.userName
	};
	const operations =
		typeof body === 'object' && body !== null
			? Reflect.get(body, 'Operations')
			: undefined;
	if (Array.isArray(operations)) {
		operations.forEach((operation) => applyOperation(next, operation));
	}

	return next;
};
export const listResponse = (resources: Record<string, unknown>[]) => ({
	itemsPerPage: resources.length,
	Resources: resources,
	schemas: [LIST_SCHEMA],
	startIndex: 1,
	totalResults: resources.length
});
export const parseFilter = (
	filter: string | undefined
): ScimUserFilter | undefined => {
	if (filter === undefined) return undefined;
	const match = FILTER_PATTERN.exec(filter);
	const attribute = match?.[1];
	const value = match?.[2];
	if (attribute === undefined || value === undefined) return undefined;

	return { attribute, value };
};
export const scimError = (
	httpStatus: number,
	detail: string,
	scimType?: string
) => {
	const body: Record<string, unknown> = {
		detail,
		schemas: [ERROR_SCHEMA],
		status: String(httpStatus)
	};
	if (scimType !== undefined) body.scimType = scimType;

	return scimJson(body, httpStatus);
};
export const scimJson = (resource: unknown, httpStatus: number) =>
	new Response(JSON.stringify(resource), {
		headers: { 'content-type': SCIM_CONTENT_TYPE },
		status: httpStatus
	});
export const serviceProviderConfig = (location: string) => ({
	bulk: { maxOperations: 0, maxPayloadSize: 0, supported: false },
	changePassword: { supported: false },
	etag: { supported: false },
	filter: { maxResults: FILTER_MAX_RESULTS, supported: true },
	meta: { location, resourceType: 'ServiceProviderConfig' },
	patch: { supported: true },
	schemas: [SPC_SCHEMA],
	sort: { supported: false }
});
