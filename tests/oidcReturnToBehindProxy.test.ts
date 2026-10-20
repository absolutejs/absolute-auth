import { expect, test } from 'bun:test';
import { auth } from '../src/index';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { generateSigningKey } from '../src/oidc/keys';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';

type TestUser = { email: string; sub: string };

const ISSUER = 'https://idp.example';
const REDIRECT_URI = 'http://localhost:53682/callback';

/* Behind a proxy the runtime sees its internal address, e.g.
 * http://idp.example:46048/... — return_to must be the public issuer origin
 * or the sign-in page refuses it as cross-origin (Management, 2026-10-20). */
test('return_to drops the internal scheme and port behind a proxy', async () => {
	const app = await auth<TestUser>({
		authSessionStore: createInMemoryAuthSessionStore<TestUser>(),
		oidc: {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([
				{
					clientId: 'claude-code',
					name: 'Claude Code',
					redirectUris: [REDIRECT_URI],
					scopes: ['openid']
				}
			]),
			issuer: ISSUER,
			loginUrl: '/bots',
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey: await generateSigningKey(),
			getClaims: (user) => ({ email: user.email }),
			getUserId: (user) => user.sub
		},
		providersConfiguration: {}
	});
	const params = new URLSearchParams({
		client_id: 'claude-code',
		code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
		code_challenge_method: 'S256',
		redirect_uri: REDIRECT_URI,
		response_type: 'code',
		scope: 'openid',
		state: 'xyz'
	});
	const response = await app.handle(
		new Request(`http://idp.example:46048/oauth2/authorize?${params}`)
	);
	const location = new URL(response.headers.get('location') ?? '', ISSUER);
	const returnTo = new URL(location.searchParams.get('return_to') ?? '');
	expect(location.pathname).toBe('/bots');
	expect(returnTo.origin).toBe(ISSUER);
	expect(returnTo.pathname).toBe('/oauth2/authorize');
	expect(returnTo.searchParams.get('client_id')).toBe('claude-code');
});
