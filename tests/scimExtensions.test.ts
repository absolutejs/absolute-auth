import { beforeEach, describe, expect, test } from 'bun:test';
import { auth } from '../src/index';
import {
	createScimToken,
	type ScimConfig
} from '../src/scim/config';
import {
	defineScimAttributeMap,
	diffScimGroupMembers
} from '../src/scim/extensions';
import { createInMemoryScimTokenStore } from '../src/scim/inMemoryScimTokenStore';
import type {
	ScimFilter,
	ScimGroupMember,
	ScimUser,
	ScimUserInput
} from '../src/scim/types';

// G7 SCIM polish: attribute mapping, group membership diff, /Schemas + /ResourceTypes.

type TestUser = { email: string; sub: string };

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NOT_FOUND = 404;
const HTTP_UNAUTHORIZED = 401;
const SCIM_CONTENT_TYPE = 'application/scim+json';
const ENTERPRISE_SCHEMA =
	'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const RESOURCE_TYPE_SCHEMA =
	'urn:ietf:params:scim:schemas:core:2.0:ResourceType';
const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';

const users = new Map<string, ScimUser>();

const getScimUser = (context: { id: string; organizationId: string }) =>
	users.get(context.id);

const listScimUsers = (context: {
	filter?: ScimFilter;
	organizationId: string;
}) => {
	void context;

	return Array.from(users.values());
};

const onScimUserCreate = (context: {
	input: ScimUserInput;
	organizationId: string;
}) => {
	const user: ScimUser = { ...context.input, id: crypto.randomUUID() };
	users.set(user.id, user);

	return user;
};

const onScimUserDeactivate = (context: {
	id: string;
	organizationId: string;
}) => {
	users.delete(context.id);
};

const onScimUserReplace = (context: {
	id: string;
	input: ScimUserInput;
	organizationId: string;
}) => {
	if (!users.has(context.id)) return undefined;
	const user: ScimUser = { ...context.input, id: context.id };
	users.set(context.id, user);

	return user;
};

// The Okta-style admin pain: their `manager` attribute → our `reporting_to` field.
const enterpriseMap = defineScimAttributeMap({
	schemas: [
		{
			attributes: [
				{
					multiValued: false,
					name: 'manager',
					required: false,
					type: 'string'
				},
				{
					multiValued: false,
					name: 'department',
					required: false,
					type: 'string'
				}
			],
			description: 'Enterprise extension',
			id: ENTERPRISE_SCHEMA,
			name: 'EnterpriseUser'
		}
	],
	fromScim: (body) => {
		const extension = body[ENTERPRISE_SCHEMA];
		if (typeof extension !== 'object' || extension === null) return {};
		const manager = Reflect.get(extension, 'manager');
		const department = Reflect.get(extension, 'department');
		const result: Record<string, unknown> = {};
		if (typeof manager === 'string') result.reporting_to = manager;
		if (typeof department === 'string') result.department = department;

		return result;
	},
	toScim: (custom) => {
		const extension: Record<string, unknown> = {};
		if (typeof custom.reporting_to === 'string') {
			extension.manager = custom.reporting_to;
		}
		if (typeof custom.department === 'string') {
			extension.department = custom.department;
		}

		return { [ENTERPRISE_SCHEMA]: extension };
	}
});

const scimTokenStore = createInMemoryScimTokenStore();
const { token } = await createScimToken(scimTokenStore, 'acme');
const authHeader = `Bearer ${token}`;

const scim: ScimConfig = {
	customAttributes: enterpriseMap,
	getScimUser,
	listScimUsers,
	onScimUserCreate,
	onScimUserDeactivate,
	onScimUserReplace,
	scimTokenStore
};

const app = await auth<TestUser>({ providersConfiguration: {}, scim });

describe('defineScimAttributeMap — round-trip through create + read', () => {
	beforeEach(() => {
		users.clear();
	});

	test('fromScim populates input.custom; toScim merges into the response', async () => {
		const created = await app.handle(
			new Request('http://localhost/scim/v2/Users', {
				body: JSON.stringify({
					active: true,
					[ENTERPRISE_SCHEMA]: {
						department: 'engineering',
						manager: 'jane@acme.test'
					},
					schemas: [USER_SCHEMA, ENTERPRISE_SCHEMA],
					userName: 'alice@acme.test'
				}),
				headers: {
					authorization: authHeader,
					'content-type': SCIM_CONTENT_TYPE
				},
				method: 'POST'
			})
		);
		expect(created.status).toBe(HTTP_CREATED);
		const createdBody = await created.json();
		expect(createdBody[ENTERPRISE_SCHEMA]).toEqual({
			department: 'engineering',
			manager: 'jane@acme.test'
		});
		expect(createdBody.schemas).toContain(ENTERPRISE_SCHEMA);

		// stored ScimUser carries the consumer's normalized custom bag
		const [stored] = Array.from(users.values());
		expect(stored?.custom).toEqual({
			department: 'engineering',
			reporting_to: 'jane@acme.test'
		});

		const fetched = await app.handle(
			new Request(`http://localhost/scim/v2/Users/${stored?.id}`, {
				headers: { authorization: authHeader }
			})
		);
		const fetchedBody = await fetched.json();
		expect(fetchedBody[ENTERPRISE_SCHEMA]).toEqual({
			department: 'engineering',
			manager: 'jane@acme.test'
		});
	});
});

describe('diffScimGroupMembers', () => {
	const member = (value: string, display?: string) =>
		(display === undefined
			? { value }
			: { display, value }) satisfies ScimGroupMember;

	test('returns added + removed by user id', () => {
		const delta = diffScimGroupMembers(
			[member('u1', 'User One'), member('u2', 'User Two')],
			[member('u2', 'User Two'), member('u3', 'User Three')]
		);
		expect(delta.added).toEqual([member('u3', 'User Three')]);
		expect(delta.removed).toEqual([member('u1', 'User One')]);
	});

	test('handles empty current + empty next', () => {
		expect(diffScimGroupMembers([], [member('u1')])).toEqual({
			added: [member('u1')],
			removed: []
		});
		expect(diffScimGroupMembers([member('u1')], [])).toEqual({
			added: [],
			removed: [member('u1')]
		});
	});
});

describe('/Schemas discovery', () => {
	test('GET /Schemas lists core User + Group + extension schemas', async () => {
		const response = await app.handle(
			new Request('http://localhost/scim/v2/Schemas', {
				headers: { authorization: authHeader }
			})
		);
		expect(response.status).toBe(HTTP_OK);
		const body = await response.json();
		expect(body.schemas).toEqual([LIST_SCHEMA]);
		const ids = body.Resources.map(
			(resource: { id: string }) => resource.id
		);
		expect(ids).toContain(USER_SCHEMA);
		expect(ids).toContain(GROUP_SCHEMA);
		expect(ids).toContain(ENTERPRISE_SCHEMA);
	});

	test('GET /Schemas/:id returns one schema or 404', async () => {
		const userSchema = await app.handle(
			new Request(
				`http://localhost/scim/v2/Schemas/${encodeURIComponent(USER_SCHEMA)}`,
				{ headers: { authorization: authHeader } }
			)
		);
		expect(userSchema.status).toBe(HTTP_OK);
		const body = await userSchema.json();
		expect(body.id).toBe(USER_SCHEMA);

		const unknown = await app.handle(
			new Request(
				'http://localhost/scim/v2/Schemas/urn:does:not:exist',
				{ headers: { authorization: authHeader } }
			)
		);
		expect(unknown.status).toBe(HTTP_NOT_FOUND);
	});

	test('GET /Schemas without a bearer is 401', async () => {
		const response = await app.handle(
			new Request('http://localhost/scim/v2/Schemas')
		);
		expect(response.status).toBe(HTTP_UNAUTHORIZED);
	});
});

describe('/ResourceTypes discovery', () => {
	test('GET /ResourceTypes lists User + Group with extension hooked into User', async () => {
		const response = await app.handle(
			new Request('http://localhost/scim/v2/ResourceTypes', {
				headers: { authorization: authHeader }
			})
		);
		expect(response.status).toBe(HTTP_OK);
		const body = await response.json();
		const userType = body.Resources.find(
			(resource: { id: string }) => resource.id === 'User'
		);
		expect(userType?.schemas).toEqual([RESOURCE_TYPE_SCHEMA]);
		expect(userType?.schemaExtensions).toEqual([
			{ required: false, schema: ENTERPRISE_SCHEMA }
		]);
		const groupType = body.Resources.find(
			(resource: { id: string }) => resource.id === 'Group'
		);
		expect(groupType?.schema).toBe(GROUP_SCHEMA);
	});

	test('GET /ResourceTypes/:id returns one or 404', async () => {
		const userType = await app.handle(
			new Request('http://localhost/scim/v2/ResourceTypes/User', {
				headers: { authorization: authHeader }
			})
		);
		expect(userType.status).toBe(HTTP_OK);

		const unknown = await app.handle(
			new Request('http://localhost/scim/v2/ResourceTypes/Widget', {
				headers: { authorization: authHeader }
			})
		);
		expect(unknown.status).toBe(HTTP_NOT_FOUND);
	});
});
