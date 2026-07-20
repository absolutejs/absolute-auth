import { describe, expect, test } from 'bun:test';
import { auth, createOidcAgentCredentialVerifier } from '../src/index';
import {
	generateSigningKey,
	signJwt,
	signingVerificationKeys,
	verifyJwtWithKeys
} from '../src/oidc/keys';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';

const ISSUER = 'https://auth.example';
const RESOURCE = 'https://api.example';
const expiresAt = () => Math.floor(Date.now() / 1000) + 60;

describe('OIDC signing rotation', () => {
	test('publishes active and previous keys while signing only with active', async () => {
		const active = await generateSigningKey();
		const previous = await generateSigningKey();
		const application = await auth({
			oidc: {
				authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
				clientStore: createInMemoryOAuthClientStore([]),
				issuer: ISSUER,
				previousSigningKeys: [previous],
				refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
				signingKey: active,
				getUserId: (user: { id: string }) => user.id
			},
			providersConfiguration: {}
		});
		const response = await application.handle(
			new Request('http://localhost/oauth2/jwks')
		);
		const body = await response.json();

		expect(body.keys.map(({ kid }: { kid: string }) => kid)).toEqual([
			active.kid,
			previous.kid
		]);
	});

	test('verifies an already-issued token only during its key overlap', async () => {
		const active = await generateSigningKey();
		const previous = await generateSigningKey();
		const token = await signJwt(
			{
				aud: RESOURCE,
				client_id: 'agent-1',
				exp: expiresAt(),
				iss: ISSUER,
				scope: 'documents:read',
				sub: 'owner-1'
			},
			previous
		);
		const overlap = signingVerificationKeys(active, [previous]);

		expect((await verifyJwtWithKeys(token, overlap))?.payload.sub).toBe(
			'owner-1'
		);
		expect(await verifyJwtWithKeys(token, [active])).toBeUndefined();
	});

	test('keeps delegated agent credentials valid through the overlap window', async () => {
		const active = await generateSigningKey();
		const previous = await generateSigningKey();
		const token = await signJwt(
			{
				aud: RESOURCE,
				client_id: 'agent-1',
				exp: expiresAt(),
				iss: ISSUER,
				scope: 'documents:read',
				sub: 'owner-1'
			},
			previous
		);
		const verify = createOidcAgentCredentialVerifier({
			issuer: ISSUER,
			publicKeys: signingVerificationKeys(active, [previous]),
			resource: RESOURCE
		});
		const principal = await verify(
			new Request(RESOURCE, {
				headers: { authorization: `Bearer ${token}` }
			})
		);

		expect(principal?.agentId).toBe('agent-1');
		expect(principal?.userId).toBe('owner-1');
	});

	test('rejects ambiguous overlapping key IDs', async () => {
		const active = await generateSigningKey();

		expect(() => signingVerificationKeys(active, [active])).toThrow(
			'OIDC signing key IDs must be unique'
		);
	});
});
