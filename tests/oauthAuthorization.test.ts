import { describe, expect, test } from 'bun:test';
import { resolveOAuthAuthorization } from '../src/utils';

describe('OAuth authorization resolution', () => {
	test('rejects a missing access token before requesting the provider profile', async () => {
		let profileRequested = false;
		const providerInstance = {
			fetchUserProfile: async () => {
				profileRequested = true;
				return { id: 1, login: 'octocat' };
			}
		};

		await expect(
			resolveOAuthAuthorization({
				authProvider: 'github',
				providerInstance: providerInstance as never,
				tokenResponse: { token_type: 'bearer' } as never
			})
		).rejects.toThrow('OAuth authorization response contains no access_token');
		expect(profileRequested).toBe(false);
	});
});
