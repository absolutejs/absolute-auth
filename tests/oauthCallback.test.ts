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

for (const intent of ['link_connector', 'link_identity'] as const) {
	test(`bound ${intent} preserves its original session and rejects account switching`, async () => {
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
			[intent === 'link_connector'
				? 'onLinkConnector'
				: 'onLinkIdentity']: ({
				currentUser,
				redirect,
				userSessionId
			}) => {
				expect(userSessionId).toBe(first);
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
							cookie: `${callbackCookies.replace('auth_intent=login', `auth_intent=${intent}`)}; auth_link_session=${first}; user_session_id=${session}`
						}
					}
				)
			);
		const linkedResponse = await invoke(first);
		expect(linkedResponse.status).toBe(302);
		expect(linkedResponse.headers.get('set-cookie')).not.toContain(
			'user_session_id='
		);
		expect((await store.getSession(first))?.user.sub).toBe('alice');
		expect(owner).toBe('alice');
		expect((await invoke(second)).status).toBe(401);
		expect(owner).toBe('alice');
		await store.removeSession(first);
		expect((await invoke(first)).status).toBe(401);
	});
}

for (const durable of [false, true]) {
	for (const helper of [false, true]) {
		test(`login rotates prior sessions (${durable ? 'store' : 'record'}, ${helper ? 'helper' : 'direct'})`, async () => {
			const { createInMemoryAuthSessionStore } = await import(
				'../src/session/inMemoryStore'
			);
			const { instantiateUserSession } = await import('../src/utils');
			const store = createInMemoryAuthSessionStore<{ sub: string }>();
			const oldId = crypto.randomUUID();
			const oldSession = {
				accessToken: 'old',
				expiresAt: Date.now() + 60_000,
				user: { sub: 'old-user' }
			};
			const pending = {
				accessToken: 'old',
				expiresAt: Date.now() + 60_000,
				userIdentity: { sub: 'old-user' }
			};
			await store.setSession(oldId, oldSession);
			await store.setUnregisteredSession(oldId, pending);
			let issuedId = oldId;
			let contextId = oldId;
			const app = callback<{ sub: string }>({
				authSessionStore: durable ? store : undefined,
				clientProviders: {
					google: {
						entries: {
							'': {
								providerInstance: {
									validateAuthorizationCode: async () => ({
										access_token: 'new'
									})
								},
								scope: ['openid']
							}
						},
						isSingleClient: true
					}
				},
				cookieSecure: true,
				onCallbackError: () => undefined,
				onCallbackSuccess: async (context) => {
					contextId = context.userSessionId;
					expect(contextId).not.toBe(oldId);
					expect(context.cookie.user_session_id.value).toBe(
						contextId
					);
					expect(context.session[oldId]).toBeUndefined();
					expect(context.unregisteredSession[oldId]).toBeUndefined();
					expect(context.currentUser?.sub).toBe('old-user');
					if (helper) {
						await instantiateUserSession({
							...context,
							cookieSecure: true,
							resolvedAuthorization: {
								accessToken: 'new',
								oauthSubject: 'new-user',
								userIdentity: { sub: 'new-user' }
							},
							user_session_id: context.cookie.user_session_id,
							getUser: () => ({ sub: 'new-user' }),
							onNewUser: () => ({ sub: 'new-user' })
						});
					} else {
						context.session[contextId] = {
							accessToken: 'new',
							expiresAt: Date.now() + 60_000,
							user: { sub: 'new-user' }
						};
					}
					const finalId = context.cookie.user_session_id.value;
					if (!finalId) throw new Error('Missing session cookie');
					issuedId = finalId;

					return context.redirect('/welcome');
				}
			});
			let records: import('../src/types').SessionRecord<{ sub: string }> =
				{};
			let pendingRecords: import('../src/types').UnregisteredSessionRecord =
				{};
			app.get('/seed', ({ store: state }) => {
				records = state.session;
				pendingRecords = state.unregisteredSession;
				records[oldId] = oldSession;
				pendingRecords[oldId] = pending;

				return 'seeded';
			});
			await app.handle(new Request('http://localhost/seed'));
			const rejected = await app.handle(
				new Request(
					'http://localhost/oauth2/callback?code=code&state=wrong',
					{
						headers: {
							cookie: `${callbackCookies}; user_session_id=${oldId}`
						}
					}
				)
			);
			expect(rejected.status).toBe(400);
			expect(rejected.headers.get('set-cookie') ?? '').not.toContain(
				'user_session_id='
			);
			expect(records[oldId]).toEqual(oldSession);
			expect(await store.getSession(oldId)).toEqual(oldSession);

			const response = await app.handle(
				new Request(
					'http://localhost/oauth2/callback?code=code&state=oauth-state',
					{
						headers: {
							cookie: `${callbackCookies}; user_session_id=${oldId}`
						}
					}
				)
			);
			expect(response.status).toBe(302);
			const cookie = response.headers.get('set-cookie');
			expect(cookie).toContain(`user_session_id=${issuedId}`);
			expect(cookie).toContain('HttpOnly');
			expect(cookie).toContain('Secure');
			expect(cookie).toContain('SameSite=Lax');
			if (durable) {
				expect(await store.getSession(oldId)).toBeUndefined();
				expect(
					await store.getUnregisteredSession(oldId)
				).toBeUndefined();
				expect((await store.getSession(issuedId))?.user.sub).toBe(
					'new-user'
				);
				if (helper)
					expect(await store.getSession(contextId)).toBeUndefined();
			} else {
				expect(records[oldId]).toBeUndefined();
				expect(pendingRecords[oldId]).toBeUndefined();
				expect(records[issuedId]?.user.sub).toBe('new-user');
			}
		});
	}
}
