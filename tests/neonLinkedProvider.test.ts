import { describe, expect, spyOn, test } from 'bun:test';
import { createInMemoryLinkedProviderStores } from '../src/linkedProviders/inMemoryStores';
import { createOAuthLinkedProviderCredentialResolver } from '../src/linkedProviders/oauthResolver';
import { createNeonProviderConfiguration } from '../src/providers/neon';

describe('Neon linked account refresh', () => {
	test('renews an expired grant through native Citra and stores the rotated token', async () => {
		const stores = createInMemoryLinkedProviderStores({
			bindings: [
				{
					availableScopes: ['urn:neoncloud:projects:read'],
					connectorProvider: 'neon',
					createdAt: 1,
					externalAccountId: 'test-subject',
					externalAccountType: 'user',
					grantId: 'neon-grant',
					id: 'neon-binding',
					status: 'active',
					updatedAt: 1
				}
			],
			grants: [
				{
					accessTokenCiphertext: 'expired-test-access',
					authProviderKey: 'neon',
					createdAt: 1,
					expiresAt: 1,
					grantedScopes: ['urn:neoncloud:projects:read'],
					id: 'neon-grant',
					ownerRef: 'test-owner',
					providerFamily: 'neon',
					providerSubject: 'test-subject',
					refreshTokenCiphertext: 'old-test-refresh',
					status: 'active',
					updatedAt: 1
				}
			]
		});
		const resolver = await createOAuthLinkedProviderCredentialResolver({
			...stores,
			providersConfiguration: {
				neon: createNeonProviderConfiguration({
					credentials: {
						clientId: 'test-client',
						clientSecret: 'test-secret',
						redirectUri:
							'https://app.example.test/auth/neon/callback'
					},
					offlineAccess: true,
					scopes: ['urn:neoncloud:projects:read']
				})
			}
		});
		const credential = await resolver.resolveCredential({
			connectorProvider: 'neon',
			ownerRef: 'test-owner'
		});
		if (!credential) throw new Error('Neon credential missing');
		const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
			Object.assign(
				async (
					input: Parameters<typeof fetch>[0],
					init?: Parameters<typeof fetch>[1]
				) => {
					const request = new Request(input, init);
					expect(request.url).toBe(
						'https://oauth2.neon.tech/oauth2/token'
					);
					const body = new URLSearchParams(await request.text());
					expect(body.get('grant_type')).toBe('refresh_token');
					expect(body.get('refresh_token')).toBe('old-test-refresh');

					return Response.json({
						access_token: 'new-test-access',
						expires_in: 3600,
						refresh_token: 'new-test-refresh',
						token_type: 'Bearer'
					});
				},
				{ preconnect: fetch.preconnect }
			)
		);
		try {
			const lease = await resolver.getAccessToken(credential);
			expect(lease.accessToken).toBe('new-test-access');
			expect(lease.grantedScopes).toEqual([
				'urn:neoncloud:projects:read'
			]);
			expect(
				(await stores.grantStore.getGrant('neon-grant'))
					?.refreshTokenCiphertext
			).toBe('new-test-refresh');
			expect(fetchSpy).toHaveBeenCalledTimes(1);
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
