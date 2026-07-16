import { describe, expect, test } from 'bun:test';
import {
	AGENT_CLAIM_GRANT_TYPE,
	AGENT_IDENTITY_ASSERTION_GRANT_TYPE,
	AGENT_IDENTITY_ASSERTION_TYPE,
	auth,
	createAgentIdentityAssertionVerifier,
	createAgentRegistrationClient,
	createAgentRegistrationCredentialVerifier,
	createInMemoryAccessTokenStore,
	createInMemoryAgentDelegationStore,
	createInMemoryAgentIdentityAssertionJtiStore,
	createInMemoryAgentIdentityRegistrationStore,
	createInMemoryAgentRegistrationStore,
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore,
	discoverAgentRegistration,
	generateAgentRegistrationGuide,
	issueAgentIdentityAssertion,
	resolveAgentPrincipal,
	revokeAgentIdentityRegistration,
	type AgentAuthConfig
} from '../src/index';
import { generateSigningKey } from '../src/oidc/keys';

const ISSUER = 'https://auth.example';
const RESOURCE = 'https://api.example';

const form = (value: Record<string, string>) =>
	new URLSearchParams(value).toString();

const setup = async ({
	allowAnonymous = false,
	providerSigningKey
}: {
	allowAnonymous?: boolean;
	providerSigningKey?: Awaited<ReturnType<typeof generateSigningKey>>;
} = {}) => {
	const signingKey = await generateSigningKey();
	const accessTokenStore = createInMemoryAccessTokenStore();
	const registrationStore = createInMemoryAgentRegistrationStore();
	const delegationStore = createInMemoryAgentDelegationStore();
	const revoked: string[] = [];
	const identityStore = createInMemoryAgentIdentityRegistrationStore();
	const config: AgentAuthConfig = {
		agentRegistration: {
			accessTokenStore,
			allowAnonymous,
			allowServiceAuth: true,
			identityStore,
			postClaimScopes: ['documents:read', 'documents:write'],
			preClaimScopes: ['documents:read'],
			signingKey,
			verifyIdentityAssertion:
				providerSigningKey === undefined
					? undefined
					: createAgentIdentityAssertionVerifier({
							audience: ISSUER,
							jtiStore:
								createInMemoryAgentIdentityAssertionJtiStore(),
							resolveIssuer: async (issuer) =>
								issuer === 'https://provider.example'
									? {
											allowedClientIds: [
												'https://provider.example/agent-auth.json',
												'https://other-agent.example/agent-auth.json'
											],
											publicJwk:
												providerSigningKey.publicJwk
										}
									: undefined
						}),
			resolveAuthenticatedUser: async (request) =>
				request.headers.get('cookie') === 'session=alice'
					? { email: 'alice@example.com', userId: 'user-alice' }
					: undefined,
			resolveVerifiedIdentity: async (identity) =>
				identity.email === 'alice@example.com'
					? { userId: 'user-alice' }
					: undefined,
			revokeAccessTokens: async (agentId) => {
				revoked.push(agentId);
			}
		},
		authorizationServer: ISSUER,
		delegationStore,
		registrationStore,
		resource: RESOURCE,
		resourceName: 'Documents API',
		scopes: ['documents:read', 'documents:write'],
		verifyCredential: createAgentRegistrationCredentialVerifier(
			accessTokenStore,
			identityStore
		)
	};
	const app = await auth({
		agentAuth: config,
		oidc: {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([]),
			issuer: ISSUER,
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey,
			getUserId: (user: { sub: string }) => user.sub
		},
		providersConfiguration: {},
		getUser: async (sub) => ({ sub })
	});

	return { app, config, revoked };
};

describe('open agent registration profile', () => {
	test('accepts a native provider ID-JAG and immediately delegates a known user', async () => {
		const providerSigningKey = await generateSigningKey();
		const { app, config } = await setup({ providerSigningKey });
		const issued = await issueAgentIdentityAssertion({
			audience: ISSUER,
			clientId: 'https://provider.example/agent-auth.json',
			issuer: 'https://provider.example',
			signingKey: providerSigningKey,
			user: {
				authenticatedAt: Date.now(),
				email: 'alice@example.com',
				emailVerified: true,
				subject: 'provider-user-alice'
			}
		});
		const response = await app.handle(
			new Request('http://localhost/agent/identity', {
				body: JSON.stringify({
					assertion: issued.assertion,
					assertion_type: AGENT_IDENTITY_ASSERTION_TYPE,
					type: 'identity_assertion'
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(response.status).toBe(200);
		const registered = await response.json();
		expect(registered.identity_assertion).toBeString();
		const exchange = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: form({
					assertion: registered.identity_assertion,
					grant_type: AGENT_IDENTITY_ASSERTION_GRANT_TYPE
				}),
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST'
			})
		);
		const tokens = await exchange.json();
		const principal = await resolveAgentPrincipal(
			new Request(RESOURCE, {
				headers: { authorization: `Bearer ${tokens.access_token}` }
			}),
			config
		);
		expect(principal?.userId).toBe('user-alice');
		expect(principal?.trust).toBe('delegated');
	});

	test('agent client discovers and starts registration without a provider SDK', async () => {
		const { app } = await setup();
		const request: typeof fetch = async (
			input: RequestInfo | URL,
			init?: RequestInit
		) =>
			app.handle(
				input instanceof Request ? input : new Request(input, init)
			);
		const discovery = await discoverAgentRegistration(RESOURCE, {
			request
		});
		expect(discovery.agentAuth.identityTypes).toEqual([
			'identity_assertion',
			'service_auth'
		]);
		const client = createAgentRegistrationClient(discovery, { request });
		const started = await client.beginServiceAuth('alice@example.com');
		expect(started.response.status).toBe(200);
		expect(started.body.registration_type).toBe('service_auth');
	});

	test('keeps different agent clients separate for the same upstream user', async () => {
		const providerSigningKey = await generateSigningKey();
		const { app } = await setup({ providerSigningKey });
		const register = async (clientId: string) => {
			const issued = await issueAgentIdentityAssertion({
				audience: ISSUER,
				clientId,
				issuer: 'https://provider.example',
				signingKey: providerSigningKey,
				user: {
					authenticatedAt: Date.now(),
					email: 'alice@example.com',
					emailVerified: true,
					subject: 'provider-user-alice'
				}
			});
			const response = await app.handle(
				new Request('http://localhost/agent/identity', {
					body: JSON.stringify({
						assertion: issued.assertion,
						assertion_type: AGENT_IDENTITY_ASSERTION_TYPE,
						type: 'identity_assertion'
					}),
					headers: { 'content-type': 'application/json' },
					method: 'POST'
				})
			);

			return response.json();
		};
		const first = await register(
			'https://provider.example/agent-auth.json'
		);
		const second = await register(
			'https://other-agent.example/agent-auth.json'
		);
		expect(first.registration_id).not.toBe(second.registration_id);
	});

	test('publishes generated auth.md and authoritative OAuth metadata', async () => {
		const { app, config } = await setup();
		const guide = await app.handle(new Request('http://localhost/auth.md'));
		expect(guide.status).toBe(200);
		expect(guide.headers.get('content-type')).toContain('text/markdown');
		expect(await guide.text()).toBe(generateAgentRegistrationGuide(config));

		const discovery = await app.handle(
			new Request(
				'http://localhost/.well-known/oauth-authorization-server'
			)
		);
		const metadata = await discovery.json();
		expect(metadata.agent_auth).toMatchObject({
			claim_endpoint: `${ISSUER}/agent/identity/claim`,
			identity_endpoint: `${ISSUER}/agent/identity`,
			identity_types_supported: ['identity_assertion', 'service_auth'],
			skill: `${ISSUER}/auth.md`
		});
		expect(metadata.grant_types_supported).toContain(
			AGENT_CLAIM_GRANT_TYPE
		);
		expect(metadata.grant_types_supported).toContain(
			AGENT_IDENTITY_ASSERTION_GRANT_TYPE
		);
	});

	test('service-owned claim produces a scoped delegated credential', async () => {
		const { app, config } = await setup();
		const start = await app.handle(
			new Request('http://localhost/agent/identity', {
				body: JSON.stringify({
					login_hint: 'alice@example.com',
					type: 'service_auth'
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(start.status).toBe(200);
		const registration = await start.json();
		expect(registration.registration_type).toBe('service_auth');
		expect(registration.claim.user_code).toMatch(/^\d{6}$/u);

		const pending = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: form({
					claim_token: registration.claim_token,
					grant_type: AGENT_CLAIM_GRANT_TYPE
				}),
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST'
			})
		);
		expect(pending.status).toBe(400);
		expect(await pending.json()).toEqual({
			error: 'authorization_pending'
		});
		const tooFast = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: form({
					claim_token: registration.claim_token,
					grant_type: AGENT_CLAIM_GRANT_TYPE
				}),
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST'
			})
		);
		expect(tooFast.status).toBe(400);
		expect(await tooFast.json()).toEqual({ error: 'slow_down' });

		const attemptToken = new URL(
			registration.claim.verification_uri
		).searchParams.get('claim_attempt_token');
		expect(attemptToken).toBeString();
		const complete = await app.handle(
			new Request('http://localhost/agent/identity/claim/complete', {
				body: JSON.stringify({
					claim_attempt_token: attemptToken,
					user_code: registration.claim.user_code
				}),
				headers: {
					'content-type': 'application/json',
					cookie: 'session=alice'
				},
				method: 'POST'
			})
		);
		expect(complete.status).toBe(204);

		const tokenResponse = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: form({
					claim_token: registration.claim_token,
					grant_type: AGENT_CLAIM_GRANT_TYPE
				}),
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST'
			})
		);
		expect(tokenResponse.status).toBe(200);
		const tokens = await tokenResponse.json();
		expect(tokens.scope).toBe('documents:read documents:write');
		expect(tokens.identity_assertion).toBeString();

		const principal = await resolveAgentPrincipal(
			new Request(RESOURCE, {
				headers: { authorization: `Bearer ${tokens.access_token}` }
			}),
			config
		);
		expect(principal).toMatchObject({
			kind: 'agent',
			scopes: ['documents:read', 'documents:write'],
			trust: 'delegated',
			userId: 'user-alice'
		});
	});

	test('anonymous claim invalidates its pre-claim assertion version', async () => {
		const { app, revoked } = await setup({ allowAnonymous: true });
		const start = await app.handle(
			new Request('http://localhost/agent/identity', {
				body: JSON.stringify({ type: 'anonymous' }),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		const registration = await start.json();
		const before = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: form({
					assertion: registration.identity_assertion,
					grant_type: AGENT_IDENTITY_ASSERTION_GRANT_TYPE
				}),
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST'
			})
		);
		expect(before.status).toBe(200);
		expect((await before.json()).scope).toBe('documents:read');

		const begin = await app.handle(
			new Request('http://localhost/agent/identity/claim', {
				body: JSON.stringify({
					claim_token: registration.claim_token,
					email: 'alice@example.com'
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		const claim = (await begin.json()).claim_attempt;
		const attemptToken = new URL(claim.verification_uri).searchParams.get(
			'claim_attempt_token'
		);
		await app.handle(
			new Request('http://localhost/agent/identity/claim/complete', {
				body: JSON.stringify({
					claim_attempt_token: attemptToken,
					user_code: claim.user_code
				}),
				headers: {
					'content-type': 'application/json',
					cookie: 'session=alice'
				},
				method: 'POST'
			})
		);
		expect(revoked).toHaveLength(1);

		const stale = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: form({
					assertion: registration.identity_assertion,
					grant_type: AGENT_IDENTITY_ASSERTION_GRANT_TYPE
				}),
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST'
			})
		);
		expect(stale.status).toBe(400);
		expect(await stale.json()).toEqual({ error: 'invalid_grant' });
	});

	test('revocation immediately rejects an already-issued access token', async () => {
		const providerSigningKey = await generateSigningKey();
		const { app, config } = await setup({ providerSigningKey });
		const issued = await issueAgentIdentityAssertion({
			audience: ISSUER,
			clientId: 'https://provider.example/agent-auth.json',
			issuer: 'https://provider.example',
			signingKey: providerSigningKey,
			user: {
				authenticatedAt: Date.now(),
				email: 'alice@example.com',
				emailVerified: true,
				subject: 'provider-user-alice'
			}
		});
		const startedResponse = await app.handle(
			new Request('http://localhost/agent/identity', {
				body: JSON.stringify({
					assertion: issued.assertion,
					assertion_type: AGENT_IDENTITY_ASSERTION_TYPE,
					type: 'identity_assertion'
				}),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		const started = await startedResponse.json();
		const exchange = await app.handle(
			new Request('http://localhost/oauth2/token', {
				body: form({
					assertion: started.identity_assertion,
					grant_type: AGENT_IDENTITY_ASSERTION_GRANT_TYPE
				}),
				headers: {
					'content-type': 'application/x-www-form-urlencoded'
				},
				method: 'POST'
			})
		);
		const tokens = await exchange.json();
		expect(
			await revokeAgentIdentityRegistration(
				config,
				started.registration_id
			)
		).toBe(true);
		expect(
			await resolveAgentPrincipal(
				new Request(RESOURCE, {
					headers: {
						authorization: `Bearer ${tokens.access_token}`
					}
				}),
				config
			)
		).toBeUndefined();
	});
});

describe('native ID-JAG provider and verifier', () => {
	test('issues audience-bound assertions and rejects replay', async () => {
		const signingKey = await generateSigningKey();
		const issued = await issueAgentIdentityAssertion({
			audience: ISSUER,
			clientId: 'https://provider.example/agent-auth.json',
			issuer: 'https://provider.example',
			signingKey,
			user: {
				authenticatedAt: Date.now(),
				email: 'alice@example.com',
				emailVerified: true,
				subject: 'user-alice'
			}
		});
		expect(issued.assertionType).toBe(AGENT_IDENTITY_ASSERTION_TYPE);
		const verify = createAgentIdentityAssertionVerifier({
			audience: ISSUER,
			jtiStore: createInMemoryAgentIdentityAssertionJtiStore(),
			resolveIssuer: async (issuer) =>
				issuer === 'https://provider.example'
					? {
							allowedClientIds: [
								'https://provider.example/agent-auth.json'
							],
							publicJwk: signingKey.publicJwk
						}
					: undefined
		});
		expect(await verify(issued.assertion)).toMatchObject({
			email: 'alice@example.com',
			issuer: 'https://provider.example',
			subject: 'user-alice'
		});
		expect(await verify(issued.assertion)).toBeUndefined();
	});
});
