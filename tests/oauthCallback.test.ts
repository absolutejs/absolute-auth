import { describe, expect, test } from 'bun:test';
import { callback } from '../src/routes/callback';

const callbackCookies = [
	'state=oauth-state',
	'code_verifier=oauth-verifier',
	'auth_provider=google',
	'auth_client=',
	'auth_intent=login',
	'origin_url=/welcome'
].join('; ');

describe('OAuth callback', () => {
	test('allows first-time OAuth callback without an existing user session cookie', async () => {
		let issuedSessionId = '';
		const app = callback<{ sub: string }>({
			clientProviders: {
				google: {
					entries: {
						'': {
							clientName: undefined,
							providerInstance: {
								validateAuthorizationCode: async () => ({
									accessToken: 'access-token',
									expiresAt: Date.now() + 60_000,
									userIdentity: { email: 'new@example.com' }
								})
							},
							scope: ['openid', 'email', 'profile']
						}
					},
					isSingleClient: true
				}
			} as never,
			onCallbackError: () => {},
			onCallbackSuccess: ({ redirect, userSessionId }) => {
				issuedSessionId = userSessionId;

				return redirect('/welcome');
			}
		});

		const response = await app.handle(
			new Request(
				'http://localhost/oauth2/callback?code=provider-code&state=oauth-state',
				{ headers: { cookie: callbackCookies } }
			)
		);

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/welcome');
		expect(issuedSessionId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
		);
	});
});
