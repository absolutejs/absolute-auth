import { expect, test } from 'bun:test';
import { authorize } from '../src/routes/authorize';
const sessionId = '111e4567-e89b-42d3-a456-426614174001';
test('bound connector authorization reads the declared session cookie and records it before redirecting', async () => {
	const app = authorize({
		bindLinkingToSession: true,
		clientProviders: {
			google: {
				entries: {
					'': {
						providerInstance: {
							createAuthorizationUrl: async () =>
								new URL(
									'https://accounts.google.com/oauth/authorize'
								)
						},
						scope: ['openid']
					}
				},
				isSingleClient: true
			}
		},
		cookieSecure: true,
		onAuthorizeError: () => undefined,
		onAuthorizeSuccess: () => undefined
	});
	const request = (cookie: string) =>
		app.handle(
			new Request(
				'http://localhost/oauth2/google/authorization?intent=link_connector',
				{ headers: { cookie } }
			)
		);
	const signedOut = await request('');
	expect(signedOut.status).toBe(401);
	const signedIn = await request(`user_session_id=${sessionId}`);
	expect(signedIn.status).toBe(302);
	const cookies = signedIn.headers.getSetCookie();
	expect(
		cookies.some(
			(cookie) =>
				cookie.includes(`auth_link_session=${sessionId}`) &&
				cookie.includes('HttpOnly') &&
				cookie.includes('Secure')
		)
	).toBe(true);
});
