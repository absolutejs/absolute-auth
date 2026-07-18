import { describe, expect, test } from 'bun:test';
import type { OAuth2Client, OAuth2TokenResponse, ProviderOption } from 'citra';
import { resolveOAuthAuthorization } from '../src/utils';

describe('OAuth authorization resolution', () => {
	test('rejects a missing access token before requesting the provider profile', async () => {
		let profileRequested = false;
		const providerInstance: Pick<
			OAuth2Client<ProviderOption>,
			'fetchUserProfile'
		> = {
			fetchUserProfile: async () => {
				profileRequested = true;

				return { id: 1, login: 'octocat' };
			}
		};
		const tokenResponse: OAuth2TokenResponse = { token_type: 'bearer' };

		await expect(
			resolveOAuthAuthorization({
				authProvider: 'github',
				providerInstance,
				tokenResponse
			})
		).rejects.toThrow(
			'OAuth authorization response contains no access_token'
		);
		expect(profileRequested).toBe(false);
	});
});
