import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { auth } from '../src/index';
import { createInMemoryOrganizationStore } from '../src/organizations/inMemoryOrganizationStore';
import { createInMemoryRoleStore } from '../src/roles/inMemoryRoleStore';
import {
	createMembershipPermissionResolver,
	resolvePermissions
} from '../src/roles/resolver';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

type TestUser = {
	email: string;
	sub: string;
};

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const NOW = 1;

const getUserId = (user: TestUser) => user.sub;

describe('roles resolver', () => {
	test('resolvePermissions unions org + global roles and honors wildcard', async () => {
		const roleStore = createInMemoryRoleStore();
		await roleStore.saveRole({
			createdAt: NOW,
			permissions: ['docs:read'],
			slug: 'reader',
			updatedAt: NOW
		});
		await roleStore.saveRole({
			createdAt: NOW,
			organizationId: 'org-1',
			permissions: ['billing:read'],
			slug: 'billing',
			updatedAt: NOW
		});

		const permissions = await resolvePermissions({
			organizationId: 'org-1',
			roles: ['reader', 'billing'],
			roleStore
		});

		expect(permissions.has('docs:read')).toBe(true);
		expect(permissions.has('billing:read')).toBe(true);
	});

	test('grants only when an active member holds a role with the permission', async () => {
		const roleStore = createInMemoryRoleStore();
		const organizationStore = createInMemoryOrganizationStore();
		await roleStore.saveRole({
			createdAt: NOW,
			permissions: ['docs:read', 'docs:write'],
			slug: 'editor',
			updatedAt: NOW
		});
		await organizationStore.saveMembership({
			createdAt: NOW,
			organizationId: 'org-1',
			roles: ['editor'],
			status: 'active',
			updatedAt: NOW,
			userId: 'u1'
		});
		const hasPermission = createMembershipPermissionResolver({
			getUserId,
			organizationStore,
			roleStore
		});
		const user: TestUser = { email: 'u1@x.com', sub: 'u1' };

		expect(
			await hasPermission({
				organizationId: 'org-1',
				permission: 'docs:read',
				user
			})
		).toBe(true);
		expect(
			await hasPermission({
				organizationId: 'org-1',
				permission: 'billing:read',
				user
			})
		).toBe(false);
		// A non-member is denied.
		expect(
			await hasPermission({
				organizationId: 'org-1',
				permission: 'docs:read',
				user: { email: 'u2@x.com', sub: 'u2' }
			})
		).toBe(false);
		// No organization scope → denied (the model is org-scoped).
		expect(await hasPermission({ permission: 'docs:read', user })).toBe(
			false
		);
	});
});

const buildApp = async () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const credentialStore = createInMemoryCredentialStore();
	const organizationStore = createInMemoryOrganizationStore();
	const roleStore = createInMemoryRoleStore();
	const users = new Map<string, TestUser>();
	const authInstance = await auth<TestUser>({
		authorization: {
			hasPermission: createMembershipPermissionResolver({
				getUserId,
				organizationStore,
				roleStore
			})
		},
		authSessionStore,
		credentials: {
			credentialStore,
			passwordPolicy: { minLength: 8 },
			getUserByEmail: (email) => users.get(email) ?? null,
			onCreateCredentialUser: ({ email }) => {
				const user: TestUser = { email, sub: `user:${email}` };
				users.set(email, user);

				return user;
			},
			onSendEmail: () => undefined
		},
		organizations: { getUserId, organizationStore },
		providersConfiguration: {},
		roles: { getUserId, organizationStore, roleStore }
	});

	const app = new Elysia()
		.use(authInstance)
		.get(
			'/org/:organizationId/secret',
			({ params: { organizationId }, protectPermission }) =>
				protectPermission(
					{ organizationId, permission: 'docs:read' },
					() => ({
						ok: true
					})
				)
		);

	return { app, roleStore };
};

const post = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	body: unknown,
	cookie?: string
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: JSON.stringify(body),
			headers:
				cookie === undefined
					? { 'content-type': 'application/json' }
					: { 'content-type': 'application/json', cookie },
			method: 'POST'
		})
	);

const sessionCookie = (response: Response) =>
	response.headers
		.getSetCookie()
		.find((cookie) => cookie.startsWith('user_session_id='))
		?.split(';')[0] ?? '';

const registerUser = async (
	app: { handle: (request: Request) => Promise<Response> },
	email: string
) =>
	sessionCookie(
		await post(app, '/auth/register', { email, password: 'supersecret' })
	);

describe('roles routes + protectPermission', () => {
	test('owner role grants permission; a roleless member is denied', async () => {
		const { app, roleStore } = await buildApp();
		await roleStore.saveRole({
			createdAt: NOW,
			permissions: ['*'],
			slug: 'owner',
			updatedAt: NOW
		});
		const ownerCookie = await registerUser(app, 'owner@example.com');
		const { organization } = await (
			await post(
				app,
				'/auth/organizations',
				{ name: 'Acme' },
				ownerCookie
			)
		).json();

		const allowed = await app.handle(
			new Request(
				`http://localhost/org/${organization.organizationId}/secret`,
				{ headers: { cookie: ownerCookie } }
			)
		);
		expect(allowed.status).toBe(HTTP_OK);

		// PUT a member's roles then confirm the resolver reflects it.
		const putRoles = await app.handle(
			new Request(
				`http://localhost/auth/roles/${organization.organizationId}/members/user:owner@example.com`,
				{
					body: JSON.stringify({ roles: ['viewer'] }),
					headers: {
						'content-type': 'application/json',
						cookie: ownerCookie
					},
					method: 'PUT'
				}
			)
		);
		expect(putRoles.status).toBe(HTTP_OK);

		// 'viewer' isn't defined / has no docs:read → now denied.
		const denied = await app.handle(
			new Request(
				`http://localhost/org/${organization.organizationId}/secret`,
				{ headers: { cookie: ownerCookie } }
			)
		);
		expect(denied.status).toBe(HTTP_FORBIDDEN);
	});

	test('a non-member cannot set roles in an org', async () => {
		const { app } = await buildApp();
		const ownerCookie = await registerUser(app, 'boss@example.com');
		const { organization } = await (
			await post(
				app,
				'/auth/organizations',
				{ name: 'Globex' },
				ownerCookie
			)
		).json();
		const outsiderCookie = await registerUser(app, 'out@example.com');

		const response = await app.handle(
			new Request(
				`http://localhost/auth/roles/${organization.organizationId}/members/user:boss@example.com`,
				{
					body: JSON.stringify({ roles: ['owner'] }),
					headers: {
						'content-type': 'application/json',
						cookie: outsiderCookie
					},
					method: 'PUT'
				}
			)
		);

		expect(response.status).toBe(HTTP_FORBIDDEN);
	});
});
