import { beforeEach, describe, expect, test } from 'bun:test';
import { auth } from '../src/index';
import {
	createScimToken,
	resolveScimOrganization,
	type ScimConfig
} from '../src/scim/config';
import { createInMemoryScimTokenStore } from '../src/scim/inMemoryScimTokenStore';
import type {
	ScimFilter,
	ScimGroup,
	ScimGroupInput,
	ScimUser,
	ScimUserInput
} from '../src/scim/types';

type TestUser = {
	email: string;
	sub: string;
};

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_IMPLEMENTED = 501;
const SCIM_CONTENT_TYPE = 'application/scim+json';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

const users = new Map<string, ScimUser>();

const getScimUser = (context: { id: string; organizationId: string }) =>
	users.get(context.id);

const listScimUsers = (context: {
	filter?: ScimFilter;
	organizationId: string;
}) => {
	const all = Array.from(users.values());
	if (context.filter === undefined) return all;
	const { attribute, value } = context.filter;

	return all.filter((user) => Reflect.get(user, attribute) === value);
};

const groups = new Map<string, ScimGroup>();

const getScimGroup = (context: { id: string; organizationId: string }) =>
	groups.get(context.id);

const listScimGroups = () => Array.from(groups.values());

const onScimGroupCreate = (context: {
	input: ScimGroupInput;
	organizationId: string;
}) => {
	const group: ScimGroup = { ...context.input, id: crypto.randomUUID() };
	groups.set(group.id, group);

	return group;
};

const onScimGroupDelete = (context: { id: string; organizationId: string }) => {
	groups.delete(context.id);
};

const onScimGroupReplace = (context: {
	id: string;
	input: ScimGroupInput;
	organizationId: string;
}) => {
	if (!groups.has(context.id)) return undefined;
	const group: ScimGroup = { ...context.input, id: context.id };
	groups.set(context.id, group);

	return group;
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

const scimTokenStore = createInMemoryScimTokenStore();
const { token: scimToken } = await createScimToken(scimTokenStore, 'acme');
const authHeader = `Bearer ${scimToken}`;

const usersOnlyScim: ScimConfig = {
	getScimUser,
	listScimUsers,
	onScimUserCreate,
	onScimUserDeactivate,
	onScimUserReplace,
	scimTokenStore
};

const scim: ScimConfig = {
	...usersOnlyScim,
	getScimGroup,
	listScimGroups,
	onScimGroupCreate,
	onScimGroupDelete,
	onScimGroupReplace
};

const app = await auth<TestUser>({ providersConfiguration: {}, scim });
const appNoGroups = await auth<TestUser>({
	providersConfiguration: {},
	scim: usersOnlyScim
});

const createBody = JSON.stringify({
	active: true,
	emails: [{ primary: true, value: 'alice@acme.test' }],
	name: { familyName: 'Anderson', givenName: 'Alice' },
	schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
	userName: 'alice@acme.test'
});

describe('SCIM token store', () => {
	test('mints a per-org token and resolves it from a bearer header', async () => {
		const store = createInMemoryScimTokenStore();
		const { token } = await createScimToken(store, 'globex');

		expect(await resolveScimOrganization(store, `Bearer ${token}`)).toBe(
			'globex'
		);
		expect(
			await resolveScimOrganization(store, 'Bearer nope')
		).toBeUndefined();
		expect(await resolveScimOrganization(store, undefined)).toBeUndefined();
	});
});

describe('SCIM 2.0 Users', () => {
	beforeEach(() => {
		users.clear();
	});

	test('rejects requests without a valid bearer token', async () => {
		const response = await app.handle(
			new Request('http://localhost/scim/v2/Users', {
				body: createBody,
				headers: { 'content-type': SCIM_CONTENT_TYPE },
				method: 'POST'
			})
		);

		expect(response.status).toBe(HTTP_UNAUTHORIZED);
	});

	test('create -> list -> get -> deactivate -> delete round-trips', async () => {
		const created = await app.handle(
			new Request('http://localhost/scim/v2/Users', {
				body: createBody,
				headers: {
					authorization: authHeader,
					'content-type': SCIM_CONTENT_TYPE
				},
				method: 'POST'
			})
		);
		expect(created.status).toBe(HTTP_CREATED);
		const createdBody = await created.json();
		const userId = Reflect.get(createdBody, 'id');
		expect(typeof userId).toBe('string');
		expect(Reflect.get(createdBody, 'userName')).toBe('alice@acme.test');

		const listed = await app.handle(
			new Request(
				`http://localhost/scim/v2/Users?filter=${encodeURIComponent(
					'userName eq "alice@acme.test"'
				)}`,
				{ headers: { authorization: authHeader } }
			)
		);
		expect(listed.status).toBe(HTTP_OK);
		expect(Reflect.get(await listed.json(), 'totalResults')).toBe(1);

		const fetched = await app.handle(
			new Request(`http://localhost/scim/v2/Users/${userId}`, {
				headers: { authorization: authHeader }
			})
		);
		expect(fetched.status).toBe(HTTP_OK);

		const patched = await app.handle(
			new Request(`http://localhost/scim/v2/Users/${userId}`, {
				body: JSON.stringify({
					Operations: [{ op: 'replace', value: { active: false } }],
					schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp']
				}),
				headers: {
					authorization: authHeader,
					'content-type': SCIM_CONTENT_TYPE
				},
				method: 'PATCH'
			})
		);
		expect(patched.status).toBe(HTTP_OK);
		expect(Reflect.get(await patched.json(), 'active')).toBe(false);

		const removed = await app.handle(
			new Request(`http://localhost/scim/v2/Users/${userId}`, {
				headers: { authorization: authHeader },
				method: 'DELETE'
			})
		);
		expect(removed.status).toBe(HTTP_NO_CONTENT);
		expect(users.size).toBe(0);
	});

	test('serves ServiceProviderConfig to an authenticated client', async () => {
		const response = await app.handle(
			new Request('http://localhost/scim/v2/ServiceProviderConfig', {
				headers: { authorization: authHeader }
			})
		);

		expect(response.status).toBe(HTTP_OK);
		expect(Reflect.get(await response.json(), 'patch')).toEqual({
			supported: true
		});
	});
});

describe('SCIM 2.0 Groups', () => {
	beforeEach(() => {
		groups.clear();
	});

	test('501s when group provisioning is not configured', async () => {
		const response = await appNoGroups.handle(
			new Request('http://localhost/scim/v2/Groups', {
				body: JSON.stringify({
					displayName: 'Eng',
					members: [],
					schemas: [GROUP_SCHEMA]
				}),
				headers: {
					authorization: authHeader,
					'content-type': SCIM_CONTENT_TYPE
				},
				method: 'POST'
			})
		);

		expect(response.status).toBe(HTTP_NOT_IMPLEMENTED);
	});

	test('create -> patch members -> delete round-trips', async () => {
		const created = await app.handle(
			new Request('http://localhost/scim/v2/Groups', {
				body: JSON.stringify({
					displayName: 'Engineering',
					members: [],
					schemas: [GROUP_SCHEMA]
				}),
				headers: {
					authorization: authHeader,
					'content-type': SCIM_CONTENT_TYPE
				},
				method: 'POST'
			})
		);
		expect(created.status).toBe(HTTP_CREATED);
		const groupId = Reflect.get(await created.json(), 'id');
		expect(typeof groupId).toBe('string');

		const patched = await app.handle(
			new Request(`http://localhost/scim/v2/Groups/${groupId}`, {
				body: JSON.stringify({
					Operations: [
						{
							op: 'add',
							path: 'members',
							value: [{ value: 'user-1' }]
						}
					],
					schemas: [PATCH_OP_SCHEMA]
				}),
				headers: {
					authorization: authHeader,
					'content-type': SCIM_CONTENT_TYPE
				},
				method: 'PATCH'
			})
		);
		expect(patched.status).toBe(HTTP_OK);
		const members = Reflect.get(await patched.json(), 'members');
		expect(Array.isArray(members) ? members.length : 0).toBe(1);

		const removed = await app.handle(
			new Request(`http://localhost/scim/v2/Groups/${groupId}`, {
				headers: { authorization: authHeader },
				method: 'DELETE'
			})
		);
		expect(removed.status).toBe(HTTP_NO_CONTENT);
		expect(groups.size).toBe(0);
	});
});
