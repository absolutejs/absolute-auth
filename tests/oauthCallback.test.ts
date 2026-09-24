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
			},
			onCallbackError: () => undefined,
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

test('bound linking refuses missing or changed starting sessions', async () => {
	let linked = false;
	const app = callback<{ sub: string }>({
		bindLinkingToSession: true,
		clientProviders: {
			google: {
				entries: {
					'': {
						providerInstance: {
							validateAuthorizationCode: async () => ({
								access_token: 'token'
							})
						},
						scope: ['openid']
					}
				},
				isSingleClient: true
			}
		},
		onCallbackError: () => undefined,
		onCallbackSuccess: () => {
			throw new Error('must not log in');
		},
		onLinkConnector: () => {
			linked = true;
		}
	});
	await Promise.all(
		['', '; auth_link_session=old-session'].map(async (suffix) => {
			const response = await app.handle(
				new Request(
					'http://localhost/oauth2/callback?code=code&state=oauth-state',
					{
						headers: {
							cookie:
								callbackCookies.replace(
									'auth_intent=login',
									'auth_intent=link_connector'
								) + suffix
						}
					}
				)
			);
			expect(response.status).toBe(401);
		})
	);
	expect(linked).toBe(false);
});

test('bound linking succeeds for its original live session and rejects account switching', async () => {
	const { createInMemoryAuthSessionStore } = await import(
		'../src/session/inMemoryStore'
	);
	const store = createInMemoryAuthSessionStore<{ sub: string }>();
	const first = '111e4567-e89b-42d3-a456-426614174001';
	const second = '222e4567-e89b-42d3-a456-426614174002';
	const future = Date.now() + 60_000;
	await store.setSession(first, {
		accessToken: 'login',
		expiresAt: future,
		oauthSubject: 'alice',
		user: { sub: 'alice' }
	});
	await store.setSession(second, {
		accessToken: 'login',
		expiresAt: future,
		oauthSubject: 'bob',
		user: { sub: 'bob' }
	});
	let owner = '';
	const app = callback<{ sub: string }>({
		authSessionStore: store,
		bindLinkingToSession: true,
		clientProviders: {
			google: {
				entries: {
					'': {
						providerInstance: {
							validateAuthorizationCode: async () => ({
								access_token: 'token'
							})
						},
						scope: ['openid']
					}
				},
				isSingleClient: true
			}
		},
		onCallbackError: () => undefined,
		onCallbackSuccess: () => {
			throw new Error('must not log in');
		},
		onLinkConnector: ({ currentUser, redirect }) => {
			owner = currentUser?.sub ?? '';

			return redirect('/connected');
		}
	});
	const invoke = (session: string) =>
		app.handle(
			new Request(
				'http://localhost/oauth2/callback?code=code&state=oauth-state',
				{
					headers: {
						cookie: `${callbackCookies.replace('auth_intent=login', 'auth_intent=link_connector')}; auth_link_session=${first}; user_session_id=${session}`
					}
				}
			)
		);
	expect((await invoke(first)).status).toBe(302);
	expect(owner).toBe('alice');
	expect((await invoke(second)).status).toBe(401);
	expect(owner).toBe('alice');
	await store.removeSession(first);
	expect((await invoke(first)).status).toBe(401);
});
