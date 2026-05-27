import type {
	ScimAttributeDefinition,
	ScimAttributeMap,
	ScimSchemaDefinition
} from './extensions';
import type {
	ScimFilter,
	ScimGroup,
	ScimGroupInput,
	ScimUser,
	ScimUserInput
} from './types';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SPC_SCHEMA =
	'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
const SCHEMA_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema';
const RESOURCE_TYPE_SCHEMA =
	'urn:ietf:params:scim:schemas:core:2.0:ResourceType';
const SCIM_CONTENT_TYPE = 'application/scim+json';
const FILTER_MAX_RESULTS = 200;

const FILTER_PATTERN = /^\s*(\w[\w.]*)\s+eq\s+"([^"]*)"\s*$/u;

const mergeCustomSchemas = (
	resource: Record<string, unknown>,
	custom: Record<string, unknown> | undefined,
	map: ScimAttributeMap | undefined
) => {
	if (custom === undefined || map === undefined) return;
	const extra = map.toScim(custom);
	for (const [key, value] of Object.entries(extra)) {
		resource[key] = value;
	}
	const extraSchemas = (map.schemas ?? []).map((schema) => schema.id);
	if (extraSchemas.length === 0) return;
	const { schemas } = resource;
	if (Array.isArray(schemas)) {
		resource.schemas = [...schemas, ...extraSchemas];
	}
};

// Serialize the package's normalized user into the SCIM 2.0 User wire format. When
// `customAttributes` is configured on the route, the consumer's `toScim` bag is merged
// into the resource and the extension schema URIs are appended to `schemas`.
export const toUserResource = (
	user: ScimUser,
	location: string,
	map?: ScimAttributeMap
) => {
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
	mergeCustomSchemas(resource, user.custom, map);

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
// When `customAttributes` is configured, the consumer's `fromScim` projects the raw body
// into a custom-attribute bag that lands on `input.custom`.
export const parseUserInput = (
	body: unknown,
	map?: ScimAttributeMap
): ScimUserInput | undefined => {
	if (typeof body !== 'object' || body === null) return undefined;

	const userName = stringField(body, 'userName');
	if (userName === undefined || userName.length === 0) return undefined;

	const active = Reflect.get(body, 'active');
	const name = Reflect.get(body, 'name');
	// Body has already been narrowed to a non-null object above; building the bag entry-
	// by-entry keeps the consumer mapper's Record<string, unknown> contract without an
	// assertion or a structural cast.
	const bodyRecord: Record<string, unknown> = {};
	for (const key of Object.keys(body)) {
		bodyRecord[key] = Reflect.get(body, key);
	}
	const custom = map === undefined ? undefined : map.fromScim(bodyRecord);

	return {
		active: typeof active === 'boolean' ? active : true,
		custom,
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
		custom: user.custom,
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
): ScimFilter | undefined => {
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
	authenticationSchemes: [
		{
			description:
				'Authentication scheme using the OAuth Bearer Token Standard',
			name: 'OAuth Bearer Token',
			primary: true,
			specUri: 'https://www.rfc-editor.org/info/rfc6750',
			type: 'oauthbearertoken'
		}
	],
	bulk: { maxOperations: 0, maxPayloadSize: 0, supported: false },
	changePassword: { supported: false },
	etag: { supported: false },
	filter: { maxResults: FILTER_MAX_RESULTS, supported: true },
	meta: { location, resourceType: 'ServiceProviderConfig' },
	patch: { supported: true },
	schemas: [SPC_SCHEMA],
	sort: { supported: false }
});

const CORE_USER_ATTRIBUTES: ScimAttributeDefinition[] = [
	{ multiValued: false, name: 'userName', required: true, type: 'string' },
	{ multiValued: false, name: 'active', required: false, type: 'boolean' },
	{ multiValued: false, name: 'displayName', required: false, type: 'string' },
	{ multiValued: false, name: 'externalId', required: false, type: 'string' },
	{
		multiValued: false,
		name: 'name',
		required: false,
		subAttributes: [
			{ multiValued: false, name: 'givenName', required: false, type: 'string' },
			{ multiValued: false, name: 'familyName', required: false, type: 'string' }
		],
		type: 'complex'
	},
	{
		multiValued: true,
		name: 'emails',
		required: false,
		subAttributes: [
			{ multiValued: false, name: 'value', required: false, type: 'string' },
			{ multiValued: false, name: 'primary', required: false, type: 'boolean' }
		],
		type: 'complex'
	}
];

const CORE_GROUP_ATTRIBUTES: ScimAttributeDefinition[] = [
	{ multiValued: false, name: 'displayName', required: true, type: 'string' },
	{ multiValued: false, name: 'externalId', required: false, type: 'string' },
	{
		multiValued: true,
		name: 'members',
		required: false,
		subAttributes: [
			{ multiValued: false, name: 'value', required: false, type: 'string' },
			{ multiValued: false, name: 'display', required: false, type: 'string' }
		],
		type: 'complex'
	}
];

const CORE_USER_SCHEMA: ScimSchemaDefinition = {
	attributes: CORE_USER_ATTRIBUTES,
	description: 'User Account',
	id: USER_SCHEMA,
	name: 'User'
};

const CORE_GROUP_SCHEMA: ScimSchemaDefinition = {
	attributes: CORE_GROUP_ATTRIBUTES,
	description: 'Group',
	id: GROUP_SCHEMA,
	name: 'Group'
};

const schemaResource = (
	schema: ScimSchemaDefinition,
	location: string
): Record<string, unknown> => ({
	attributes: schema.attributes,
	description: schema.description ?? schema.name,
	id: schema.id,
	meta: { location, resourceType: 'Schema' },
	name: schema.name
});

// `/Schemas` — full registry the IdP can probe to learn what attributes this server knows
// about. Always includes the two core schemas; appends consumer-declared extensions.
export const schemaList = (
	location: string,
	extras: ScimSchemaDefinition[] = []
) => {
	const all = [CORE_USER_SCHEMA, CORE_GROUP_SCHEMA, ...extras];
	const resources = all.map((schema) =>
		schemaResource(schema, `${location}/${schema.id}`)
	);

	return listResponse(resources);
};

// `/Schemas/:id` — one schema by URI.
export const schemaOne = (
	location: string,
	id: string,
	extras: ScimSchemaDefinition[] = []
) => {
	const all = [CORE_USER_SCHEMA, CORE_GROUP_SCHEMA, ...extras];
	const found = all.find((schema) => schema.id === id);
	if (found === undefined) return undefined;

	return schemaResource(found, location);
};

const resourceTypeUser = (
	location: string,
	usersEndpoint: string,
	extensionSchemaIds: string[]
) => ({
	description: 'User Account',
	endpoint: usersEndpoint,
	id: 'User',
	meta: { location, resourceType: 'ResourceType' },
	name: 'User',
	schema: USER_SCHEMA,
	schemaExtensions: extensionSchemaIds.map((schema) => ({
		required: false,
		schema
	})),
	schemas: [RESOURCE_TYPE_SCHEMA]
});

const resourceTypeGroup = (location: string, groupsEndpoint: string) => ({
	description: 'Group',
	endpoint: groupsEndpoint,
	id: 'Group',
	meta: { location, resourceType: 'ResourceType' },
	name: 'Group',
	schema: GROUP_SCHEMA,
	schemas: [RESOURCE_TYPE_SCHEMA]
});

// `/ResourceTypes` — both User + Group, with the consumer's extension schemas attached
// to the User type (the only one extensions land on in practice).
export const resourceTypeList = (
	location: string,
	usersEndpoint: string,
	groupsEndpoint: string,
	extras: ScimSchemaDefinition[] = []
) =>
	listResponse([
		resourceTypeUser(
			`${location}/User`,
			usersEndpoint,
			extras.map((schema) => schema.id)
		),
		resourceTypeGroup(`${location}/Group`, groupsEndpoint)
	]);

// `/ResourceTypes/:id` — one resource type by name.
export const resourceTypeOne = (
	location: string,
	id: string,
	usersEndpoint: string,
	groupsEndpoint: string,
	extras: ScimSchemaDefinition[] = []
) => {
	if (id === 'User') {
		return resourceTypeUser(
			location,
			usersEndpoint,
			extras.map((schema) => schema.id)
		);
	}
	if (id === 'Group') return resourceTypeGroup(location, groupsEndpoint);

	return undefined;
};

// Re-export for the routes module that builds /Schemas + /ResourceTypes URLs.
export { RESOURCE_TYPE_SCHEMA, SCHEMA_SCHEMA };

const REMOVE_MEMBER_PATTERN = /^members\[\s*value\s+eq\s+"([^"]*)"\s*\]$/iu;

const parseMembers = (value: unknown) => {
	if (!Array.isArray(value)) return [];

	return value.flatMap((entry) => {
		const memberValue = stringField(entry, 'value');
		if (memberValue === undefined) return [];
		const display = stringField(entry, 'display');

		return [
			display === undefined
				? { value: memberValue }
				: { display, value: memberValue }
		];
	});
};

const applyGroupValueObject = (target: ScimGroupInput, value: object) => {
	const displayName = stringField(value, 'displayName');
	if (displayName !== undefined) target.displayName = displayName;
	const members = Reflect.get(value, 'members');
	if (Array.isArray(members)) target.members = parseMembers(members);
};

const applyGroupPath = (
	target: ScimGroupInput,
	path: string,
	opName: string,
	value: unknown
) => {
	const removed = REMOVE_MEMBER_PATTERN.exec(path);
	if (removed !== null) {
		target.members = target.members.filter(
			(member) => member.value !== removed[1]
		);

		return;
	}

	const key = path.toLowerCase();
	if (key === 'displayname' && typeof value === 'string') {
		target.displayName = value;
	}
	if (key === 'members' && opName === 'remove') target.members = [];
	if (key === 'members' && opName !== 'remove') {
		target.members =
			opName === 'add'
				? [...target.members, ...parseMembers(value)]
				: parseMembers(value);
	}
};

const applyGroupOperation = (target: ScimGroupInput, operation: unknown) => {
	if (typeof operation !== 'object' || operation === null) return;
	const rawOp = Reflect.get(operation, 'op');
	const op = typeof rawOp === 'string' ? rawOp.toLowerCase() : 'add';
	const path = Reflect.get(operation, 'path');
	const value = Reflect.get(operation, 'value');
	if (typeof path === 'string') {
		applyGroupPath(target, path, op, value);

		return;
	}
	if (typeof value === 'object' && value !== null) {
		applyGroupValueObject(target, value);
	}
};

// Serialize the package's normalized group into the SCIM 2.0 Group wire format.
export const applyGroupPatch = (group: ScimGroup, body: unknown) => {
	const next: ScimGroupInput = {
		displayName: group.displayName,
		externalId: group.externalId,
		members: [...group.members]
	};
	const operations =
		typeof body === 'object' && body !== null
			? Reflect.get(body, 'Operations')
			: undefined;
	if (Array.isArray(operations)) {
		operations.forEach((operation) => applyGroupOperation(next, operation));
	}

	return next;
};
export const parseGroupInput = (body: unknown): ScimGroupInput | undefined => {
	const displayName = stringField(body, 'displayName');
	if (displayName === undefined || displayName.length === 0) return undefined;

	return {
		displayName,
		externalId: stringField(body, 'externalId'),
		members: parseMembers(Reflect.get(Object(body), 'members'))
	};
};
export const toGroupResource = (group: ScimGroup, location: string) => {
	const resource: Record<string, unknown> = {
		displayName: group.displayName,
		id: group.id,
		members: group.members.map((member) =>
			member.display === undefined
				? { value: member.value }
				: { display: member.display, value: member.value }
		),
		meta: { location, resourceType: 'Group' },
		schemas: [GROUP_SCHEMA]
	};
	if (group.externalId !== undefined) resource.externalId = group.externalId;

	return resource;
};
