import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createAuthContext } from '../src/authContext';
import { issueTokenSet, type OidcProviderConfig } from '../src/oidc/config';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore,
	createInMemorySocketTicketStore
} from '../src/oidc/inMemoryStores';
import { generateSigningKey } from '../src/oidc/keys';
import { issueSocketTicket } from '../src/oidc/socketTickets';

type User = { id: string; role: string };

describe('Absolute Auth Sync bridge', () => {
	test('maps bearer and one-time ticket credentials to the same typed context', async () => {
		const issuer = 'https://api.example';
		const user: User = { id: 'user-1', role: 'member' };
		const socketTicketStore = createInMemorySocketTicketStore();
		const oidc: OidcProviderConfig<User> = {
			authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
			clientStore: createInMemoryOAuthClientStore([]),
			issuer,
			refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
			signingKey: await generateSigningKey(),
			socketTicketStore,
			getUserId: (candidate) => candidate.id
		};
		const accessTokens = {
			oidc,
			getUser: (subject: string) => (subject === user.id ? user : null)
		};
		const tokens = await issueTokenSet({
			audience: issuer,
			clientId: 'native-client',
			config: oidc,
			scopes: ['openid', 'sync'],
			sub: user.id
		});
		const issued = await issueSocketTicket({
			audience: issuer,
			clientId: 'native-client',
			scopes: ['openid', 'sync'],
			store: socketTicketStore,
			subject: user.id
		});
		const app = new Elysia()
			.use(createAuthContext({ accessTokens }))
			.get('/bearer', ({ absoluteAuthSync, headers }) =>
				absoluteAuthSync?.resolveBearer({
					authorization: headers.authorization
				})
			)
			.post('/ticket', ({ absoluteAuthSync, body }) =>
				absoluteAuthSync?.consumeSocketTicket({
					ticket: String(Reflect.get(Object(body), 'ticket'))
				})
			);

		const bearerResponse = await app.handle(
			new Request('http://localhost/bearer', {
				headers: {
					authorization: `Bearer ${tokens.access_token}`
				}
			})
		);
		expect(bearerResponse.status).toBe(200);
		const bearerText = await bearerResponse.text();
		expect(bearerText.length).toBeGreaterThan(0);
		const bearer = JSON.parse(bearerText);
		const ticketResponse = await app.handle(
			new Request('http://localhost/ticket', {
				body: JSON.stringify({ ticket: issued.ticket }),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(ticketResponse.status).toBe(200);
		const ticketText = await ticketResponse.text();
		expect(ticketText.length).toBeGreaterThan(0);
		const ticket = JSON.parse(ticketText);

		expect(bearer.user).toEqual(user);
		expect(ticket.user).toEqual(user);
		expect(bearer.authPrincipal).toMatchObject({
			clientId: 'native-client',
			kind: 'access-token',
			subject: user.id
		});
		expect(ticket.authPrincipal).toEqual(bearer.authPrincipal);

		const replay = await app.handle(
			new Request('http://localhost/ticket', {
				body: JSON.stringify({ ticket: issued.ticket }),
				headers: { 'content-type': 'application/json' },
				method: 'POST'
			})
		);
		expect(await replay.text()).toBe('');
	});
});
