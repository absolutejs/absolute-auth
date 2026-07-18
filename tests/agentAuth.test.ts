import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { hashToken } from '../src/crypto';
import {
	agentAuthPlugin,
	auth,
	createInMemoryAgentDelegationStore,
	createInMemoryAgentRegistrationStore,
	createOidcAgentCredentialVerifier,
	type AgentAuthConfig,
	type UserSessionId
} from '../src/index';
import { generateSigningKey, signJwt } from '../src/oidc/keys';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryClientRegistrationTokenStore,
	createInMemoryDeviceAuthorizationStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

const ISSUER = 'https://auth.example';
const RESOURCE = 'https://api.example';
const SESSION_ID: UserSessionId = '11111111-1111-4111-8111-111111111111';

const setupAgentPlugin = async () => {
	const signingKey = await generateSigningKey();
	const registrationStore = createInMemoryAgentRegistrationStore();
	const delegationStore = createInMemoryAgentDelegationStore();
	const now = Date.now();
	await registrationStore.saveRegistration({
		agentId: 'agent-1',
		allowedScopes: ['documents:read', 'documents:write'],
		clientId: 'agent-1',
		createdAt: now,
		name: 'Research Agent',
		status: 'active',
		updatedAt: now
	});
	await delegationStore.saveDelegation({
		agentId: 'agent-1',
		createdAt: now,
		delegationId: 'delegation-1',
		scopes: ['documents:read'],
		status: 'active',
		updatedAt: now,
		userId: 'user-1'
	});
	const config: AgentAuthConfig = {
		authorizationServer: ISSUER,
		delegationStore,
		registrationStore,
		resource: RESOURCE,
		resourceName: 'Documents API',
		scopes: ['documents:read', 'documents:write'],
		verifyCredential: createOidcAgentCredentialVerifier({
			issuer: ISSUER,
			publicJwk: signingKey.publicJwk,
			resource: RESOURCE
		})
	};
	const app = new Elysia()
		.use(agentAuthPlugin(config))
		.get('/documents', ({ protectAgent }) =>
			protectAgent(['documents:read'], (principal) => principal)
		)
		.post('/documents', ({ protectAgent }) =>
			protectAgent(['documents:write'], (principal) => principal)
		);
	const token = await signJwt(
		{
			aud: RESOURCE,
			client_id: 'agent-1',
			exp: Math.floor((now + 60_000) / 1000),
			iat: Math.floor(now / 1000),
			iss: ISSUER,
			scope: 'documents:read documents:write',
			sub: 'user-1'
		},
		signingKey
	);

	return { app, token };
};

describe('agent auth resource and guard', () => {
	test('publishes RFC 9728 protected-resource metadata', async () => {
		const { app } = await setupAgentPlugin();
		const response = await app.handle(
			new Request('http://localhost/.well-known/oauth-protected-resource')
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			authorization_servers: [ISSUER],
			bearer_methods_supported: ['header'],
			resource: RESOURCE,
			resource_name: 'Documents API',
			scopes_supported: ['documents:read', 'documents:write']
		});
	});

	test('resolves a delegated agent and intersects delegation scopes', async () => {
		const { app, token } = await setupAgentPlugin();
		const response = await app.handle(
			new Request('http://localhost/documents', {
				headers: { authorization: `Bearer ${token}` }
			})
		);

		expect(response.status).toBe(200);
		const principal = await response.json();
		expect(principal.kind).toBe('agent');
		expect(principal.agentId).toBe('agent-1');
		expect(principal.userId).toBe('user-1');
		expect(principal.scopes).toEqual(['documents:read']);
	});

	test('returns standard challenges for missing credentials and insufficient scope', async () => {
		const { app, token } = await setupAgentPlugin();
		const missing = await app.handle(
			new Request('http://localhost/documents')
		);
		expect(missing.status).toBe(401);
		expect(missing.headers.get('www-authenticate')).toContain(
			'resource_metadata="https://api.example/.well-known/oauth-protected-resource"'
		);

		const denied = await app.handle(
			new Request('http://localhost/documents', {
				headers: { authorization: `Bearer ${token}` },
				method: 'POST'
			})
		);
		expect(denied.status).toBe(403);
		expect(denied.headers.get('www-authenticate')).toContain(
			'error="insufficient_scope"'
		);
		expect(denied.headers.get('www-authenticate')).toContain(
			'scope="documents:write"'
		);
	});
});

describe('standards-based agent onboarding', () => {
	test('authorization-code approval creates the same durable delegation', async () => {
		type User = { sub: string };
		const signingKey = await generateSigningKey();
		const registrationStore = createInMemoryAgentRegistrationStore();
		const delegationStore = createInMemoryAgentDelegationStore();
		const authSessionStore = createInMemoryAuthSessionStore<User>();
		const now = Date.now();
		await registrationStore.saveRegistration({
			agentId: 'authorization-code-agent',
			allowedScopes: ['documents:read'],
			clientId: 'authorization-code-agent',
			createdAt: now,
			name: 'Authorization Code Agent',
			status: 'active',
			updatedAt: now
		});
		await authSessionStore.setSession(SESSION_ID, {
			authenticatedAt: now,
			expiresAt: now + 60_000,
			user: { sub: 'user-1' }
		});
		const app = await auth<User>({
			agentAuth: {
				authorizationServer: ISSUER,
				delegationStore,
				registrationStore,
				resource: RESOURCE,
				scopes: ['documents:read'],
				verifyCredential: createOidcAgentCredentialVerifier({
					issuer: ISSUER,
					publicJwk: signingKey.publicJwk,
					resource: RESOURCE
				})
			},
			authSessionStore,
			oidc: {
				authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
				clientStore: createInMemoryOAuthClientStore([
					{
						clientId: 'authorization-code-agent',
						name: 'Authorization Code Agent',
						redirectUris: ['https://agent.example/callback'],
						scopes: ['documents:read']
					}
				]),
				issuer: ISSUER,
				refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
				signingKey,
				getUserId: (user) => user.sub
			},
			providersConfiguration: {},
			getUser: async (sub) => ({ sub })
		});
		const verifier = 'agent-auth-pkce-verifier-012345678901234567890';
		const query = new URLSearchParams({
			client_id: 'authorization-code-agent',
			code_challenge: await hashToken(verifier),
			code_challenge_method: 'S256',
			redirect_uri: 'https://agent.example/callback',
			resource: RESOURCE,
			response_type: 'code',
			scope: 'documents:read'
		});
		const response = await app.handle(
			new Request(
				`http://localhost/oauth2/authorize?${query.toString()}`,
				{
					headers: { cookie: `user_session_id=${SESSION_ID}` }
				}
			)
		);

		expect(response.status).toBe(302);
		expect(
			await delegationStore.findActiveDelegation({
				agentId: 'authorization-code-agent',
				userId: 'user-1'
			})
		).toMatchObject({ scopes: ['documents:read'], status: 'active' });
	});

	test('DCR registers an agent and device approval creates its delegation', async () => {
		type User = { sub: string };
		const signingKey = await generateSigningKey();
		const registrationStore = createInMemoryAgentRegistrationStore();
		const delegationStore = createInMemoryAgentDelegationStore();
		const authSessionStore = createInMemoryAuthSessionStore<User>();
		await authSessionStore.setSession(SESSION_ID, {
			authenticatedAt: Date.now(),
			expiresAt: Date.now() + 60_000,
			user: { sub: 'user-1' }
		});
		const app = await auth<User>({
			agentAuth: {
				authorizationServer: ISSUER,
				delegationStore,
				registerDynamicClients: true,
				registrationStore,
				resource: RESOURCE,
				scopes: ['documents:read'],
				verifyCredential: createOidcAgentCredentialVerifier({
					issuer: ISSUER,
					publicJwk: signingKey.publicJwk,
					resource: RESOURCE
				})
			},
			authSessionStore,
			oidc: {
				authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
				clientRegistrationTokenStore:
					createInMemoryClientRegistrationTokenStore(),
				clientStore: createInMemoryOAuthClientStore([]),
				deviceAuthorizationStore:
					createInMemoryDeviceAuthorizationStore(),
				issuer: ISSUER,
				refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
				signingKey,
				getUserId: (user) => user.sub
			},
			providersConfiguration: {},
			getUser: async (sub) => ({ sub })
		});

		const registered = await app.handle(
			new Request('http://localhost/oauth2/register', {
				body: JSON.stringify({
					client_name: 'Research Agent',
					grant_types: [
						'urn:ietf:params:oauth:grant-type:device_code',
						'urn:ietf:params:oauth:grant-type:token-exchange'
					],
					scope: 'documents:read'
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(registered.status).toBe(200);
		const registrationBody = await registered.json();
		const clientId = registrationBody.client_id;
		if (typeof clientId !== 'string') {
			throw new TypeError(
				'Dynamic registration did not return a client_id'
			);
		}
		expect((await registrationStore.findByClientId(clientId))?.name).toBe(
			'Research Agent'
		);

		const device = await app.handle(
			new Request('http://localhost/oauth2/device_authorization', {
				body: new URLSearchParams({
					client_id: clientId,
					scope: 'documents:read'
				}),
				method: 'POST'
			})
		);
		expect(device.status).toBe(200);
		const deviceBody = await device.json();

		const approval = await app.handle(
			new Request('http://localhost/oauth2/device/decision', {
				body: JSON.stringify({
					action: 'approve',
					user_code: deviceBody.user_code
				}),
				headers: {
					'content-type': 'application/json',
					cookie: `user_session_id=${SESSION_ID}`
				},
				method: 'POST'
			})
		);
		expect(approval.status).toBe(200);
		const delegation = await delegationStore.findActiveDelegation({
			agentId: clientId,
			userId: 'user-1'
		});
		expect(delegation?.scopes).toEqual(['documents:read']);
	});
});
