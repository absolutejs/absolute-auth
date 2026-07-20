import { describe, expect, test } from 'bun:test';
import {
	auth,
	createInMemoryAgentDelegationStore,
	createInMemoryAgentRegistrationStore,
	createInMemoryAuthorizationCodeStore,
	createInMemoryClientRegistrationTokenStore,
	createInMemoryDeviceAuthorizationStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore,
	generateAgentOAuthGuide,
	type AgentAuthConfig,
	type AgentOAuthGuideConfig
} from '../src/index';
import { generateSigningKey } from '../src/oidc/keys';

const ISSUER = 'https://auth.example';
const HTTP_OK = 200;
const oauthGuide = {
	authorizationServer: ISSUER,
	resources: [
		{
			metadataUrl:
				'https://api.example/.well-known/oauth-protected-resource/documents',
			name: 'Documents',
			resource: 'https://api.example/documents',
			scopes: ['documents:read']
		},
		{
			metadataUrl:
				'https://api.example/.well-known/oauth-protected-resource/search',
			name: 'Search',
			resource: 'https://api.example/search',
			scopes: ['search:read']
		}
	],
	serviceName: 'Example API'
} as const;

const setup = async () => {
	const signingKey = await generateSigningKey();
	const config: AgentAuthConfig = {
		allowUndelegated: false,
		authorizationServer: ISSUER,
		delegationStore: createInMemoryAgentDelegationStore(),
		oauthGuide,
		registerDynamicClients: true,
		registrationStore: createInMemoryAgentRegistrationStore(),
		resource: 'https://api.example',
		resourceName: 'Example API',
		scopes: ['documents:read', 'search:read'],
		verifyCredential: async () => undefined
	};
	const app = await auth({
		agentAuth: config,
		oidc: {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientRegistrationTokenStore:
				createInMemoryClientRegistrationTokenStore(),
			clientStore: createInMemoryOAuthClientStore([]),
			deviceAuthorizationStore: createInMemoryDeviceAuthorizationStore(),
			issuer: ISSUER,
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey,
			getUserId: (user: { subject: string }) => user.subject
		},
		providersConfiguration: {},
		getUser: async (subject) => ({ subject })
	});

	return { app, config };
};

describe('OAuth agent guide', () => {
	test('publishes one guide derived from exact resources and scopes', async () => {
		const { app } = await setup();
		const response = await app.handle(
			new Request('https://auth.example/auth.md')
		);
		const body = await response.text();

		expect(response.status).toBe(HTTP_OK);
		expect(response.headers.get('content-type')).toContain('text/markdown');
		expect(body).toBe(generateAgentOAuthGuide(oauthGuide));
		expect(body).toContain('https://api.example/documents');
		expect(body).toContain('`documents:read`');
		expect(body).toContain('https://api.example/search');
		expect(body).not.toContain('documents:write');
	});

	test('links the guide from authoritative OAuth discovery', async () => {
		const { app } = await setup();
		const response = await app.handle(
			new Request(
				'https://auth.example/.well-known/oauth-authorization-server'
			)
		);
		const metadata = await response.json();

		expect(metadata.service_documentation).toBe(`${ISSUER}/auth.md`);
		expect(metadata.registration_endpoint).toBe(
			`${ISSUER}/oauth2/register`
		);
		expect(metadata.device_authorization_endpoint).toBe(
			`${ISSUER}/oauth2/device_authorization`
		);
	});

	test('rejects empty, duplicate, or insecure resource contracts', () => {
		expect(() =>
			generateAgentOAuthGuide({ ...oauthGuide, resources: [] })
		).toThrow('at least one resource');
		expect(() =>
			generateAgentOAuthGuide({
				...oauthGuide,
				resources: [oauthGuide.resources[0], oauthGuide.resources[0]]
			})
		).toThrow('must be unique');
		expect(() =>
			generateAgentOAuthGuide({
				...oauthGuide,
				resources: [
					{
						...oauthGuide.resources[0],
						resource: 'http://api.example/documents'
					}
				]
			})
		).toThrow('must use HTTPS');
	});

	test('fails startup when the guide drifts from configured OAuth authority', async () => {
		const signingKey = await generateSigningKey();
		const base: Omit<AgentAuthConfig, 'oauthGuide'> = {
			authorizationServer: ISSUER,
			delegationStore: createInMemoryAgentDelegationStore(),
			registrationStore: createInMemoryAgentRegistrationStore(),
			resource: 'https://api.example',
			resourceName: 'Example API',
			scopes: ['documents:read'],
			verifyCredential: async () => undefined
		};
		const configure = (guide: AgentOAuthGuideConfig) =>
			auth({
				agentAuth: { ...base, oauthGuide: guide },
				oidc: {
					authorizationCodeStore:
						createInMemoryAuthorizationCodeStore(),
					clientStore: createInMemoryOAuthClientStore([]),
					issuer: ISSUER,
					refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
					signingKey,
					getUserId: (user: { subject: string }) => user.subject
				},
				providersConfiguration: {},
				getUser: async (subject) => ({ subject })
			});

		await expect(
			configure({
				...oauthGuide,
				authorizationServer: 'https://other.example'
			})
		).rejects.toThrow('must equal agentAuth.authorizationServer');
		await expect(configure(oauthGuide)).rejects.toThrow(
			'undeclared scopes'
		);
	});
});
