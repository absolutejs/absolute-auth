import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createInMemoryCredentialStore } from '../src/credentials/inMemoryCredentialStore';
import { auth } from '../src/index';
import type { OrganizationInvitationMessage } from '../src/organizations/config';
import { createInMemoryOrganizationStore } from '../src/organizations/inMemoryOrganizationStore';
import { autoAssignOrgsByEmail } from '../src/organizations/operations';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import type { OrganizationId } from '../src/tenancy';

type TestUser = {
	email: string;
	sub: string;
};

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;

const buildApp = async () => {
	const authSessionStore = createInMemoryAuthSessionStore<TestUser>();
	const credentialStore = createInMemoryCredentialStore();
	const organizationStore = createInMemoryOrganizationStore();
	const users = new Map<string, TestUser>();
	const invites: OrganizationInvitationMessage[] = [];
	const authInstance = await auth<TestUser>({
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
		organizations: {
			organizationStore,
			getUserId: (user) => user.sub,
			onSendInvitation: (message) => {
				invites.push(message);
			}
		},
		providersConfiguration: {}
	});

	return { app: new Elysia().use(authInstance), invites };
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

const send = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	method: string,
	cookie: string
) =>
	app.handle(
		new Request(`http://localhost${path}`, { headers: { cookie }, method })
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

describe('organizations', () => {
	test('creates an org with the caller as owner and lists it', async () => {
		const { app } = await buildApp();
		const cookie = await registerUser(app, 'owner@example.com');

		const created = await post(
			app,
			'/auth/organizations',
			{ name: 'Acme' },
			cookie
		);
		expect(created.status).toBe(HTTP_OK);
		const { organization } = await created.json();
		expect(organization.name).toBe('Acme');

		const listed = await send(app, '/auth/organizations', 'GET', cookie);
		const { organizations } = await listed.json();
		expect(organizations).toHaveLength(1);
		expect(organizations[0].membership.roles).toContain('owner');
	});

	test('create requires authentication', async () => {
		const { app } = await buildApp();

		const response = await post(app, '/auth/organizations', { name: 'X' });

		expect(response.status).toBe(HTTP_UNAUTHORIZED);
	});

	test('invite → accept makes the invitee an active member', async () => {
		const { app, invites } = await buildApp();
		const ownerCookie = await registerUser(app, 'boss@example.com');
		const { organization } = await (
			await post(
				app,
				'/auth/organizations',
				{ name: 'Globex' },
				ownerCookie
			)
		).json();

		const invited = await post(
			app,
			`/auth/organizations/${organization.organizationId}/invitations`,
			{ email: 'new@example.com', roles: ['member'] },
			ownerCookie
		);
		expect(invited.status).toBe(HTTP_OK);
		expect(invites).toHaveLength(1);
		const { token } = invites[0] ?? { token: '' };

		const inviteeCookie = await registerUser(app, 'new@example.com');
		const accepted = await post(
			app,
			'/auth/organizations/invitations/accept',
			{ token },
			inviteeCookie
		);
		expect(accepted.status).toBe(HTTP_OK);
		expect((await accepted.json()).organizationId).toBe(
			organization.organizationId
		);

		const members = await send(
			app,
			`/auth/organizations/${organization.organizationId}/members`,
			'GET',
			ownerCookie
		);
		expect((await members.json()).members).toHaveLength(2);
	});

	test('a non-member cannot invite to an org', async () => {
		const { app } = await buildApp();
		const ownerCookie = await registerUser(app, 'a@example.com');
		const { organization } = await (
			await post(
				app,
				'/auth/organizations',
				{ name: 'Initech' },
				ownerCookie
			)
		).json();

		const outsiderCookie = await registerUser(app, 'outsider@example.com');
		const response = await post(
			app,
			`/auth/organizations/${organization.organizationId}/invitations`,
			{ email: 'x@example.com' },
			outsiderCookie
		);

		expect(response.status).toBe(HTTP_FORBIDDEN);
	});

	test('a revoked invitation cannot be accepted', async () => {
		const { app, invites } = await buildApp();
		const ownerCookie = await registerUser(app, 'admin@example.com');
		const { organization } = await (
			await post(
				app,
				'/auth/organizations',
				{ name: 'Hooli' },
				ownerCookie
			)
		).json();

		const invited = await post(
			app,
			`/auth/organizations/${organization.organizationId}/invitations`,
			{ email: 'pending@example.com' },
			ownerCookie
		);
		const { invitationId } = await invited.json();
		const { token } = invites[0] ?? { token: '' };

		const revoked = await send(
			app,
			`/auth/organizations/${organization.organizationId}/invitations/${invitationId}`,
			'DELETE',
			ownerCookie
		);
		expect(revoked.status).toBe(HTTP_OK);

		const inviteeCookie = await registerUser(app, 'pending@example.com');
		const accepted = await post(
			app,
			'/auth/organizations/invitations/accept',
			{ token },
			inviteeCookie
		);
		expect(accepted.status).toBe(HTTP_BAD_REQUEST);
	});
});

describe('autoAssignOrgsByEmail', () => {
	test('adds the user to every org their domain maps to (idempotent)', async () => {
		const organizationStore = createInMemoryOrganizationStore();
		const acmeId: OrganizationId = 'org_acme';
		const otherId: OrganizationId = 'org_other';
		const now = Date.now();
		await organizationStore.saveOrganization({
			createdAt: now,
			name: 'Acme',
			organizationId: acmeId,
			updatedAt: now
		});
		await organizationStore.saveOrganization({
			createdAt: now,
			name: 'Other',
			organizationId: otherId,
			updatedAt: now
		});

		const domains: Record<string, OrganizationId[]> = {
			'acme.com': [acmeId],
			'other.com': [otherId]
		};
		const getOrgsForDomain = (domain: string) => domains[domain] ?? [];

		const first = await autoAssignOrgsByEmail({
			email: 'alice@ACME.com',
			getOrgsForDomain,
			organizationStore,
			roles: ['member'],
			userId: 'user-alice'
		});
		expect(first).toEqual([acmeId]);

		// Second call is idempotent — already a member, no duplicate added.
		const second = await autoAssignOrgsByEmail({
			email: 'alice@acme.com',
			getOrgsForDomain,
			organizationStore,
			userId: 'user-alice'
		});
		expect(second).toEqual([]);

		// Different domain → assigned to a different org.
		const third = await autoAssignOrgsByEmail({
			email: 'bob@other.com',
			getOrgsForDomain,
			organizationStore,
			userId: 'user-bob'
		});
		expect(third).toEqual([otherId]);

		// Unmapped domain → no assignment, no error.
		const fourth = await autoAssignOrgsByEmail({
			email: 'eve@unknown.org',
			getOrgsForDomain,
			organizationStore,
			userId: 'user-eve'
		});
		expect(fourth).toEqual([]);
	});
});
