import { describe, expect, test } from 'bun:test';
import {
	approveBackchannelAuth,
	CIBA_GRANT_TYPE,
	denyBackchannelAuth,
	exchangeBackchannelAuth,
	issueBackchannelAuth,
	type OidcProviderConfig
} from '../src/oidc/config';
import {
	createInMemoryAuthorizationCodeStore,
	createInMemoryBackchannelAuthStore,
	createInMemoryOAuthClientStore,
	createInMemoryOidcRefreshTokenStore
} from '../src/oidc/inMemoryStores';
import { generateSigningKey } from '../src/oidc/keys';

// OIDC CIBA Core 1.0 — desktop client kicks off /bc-authorize with a login_hint, server
// pushes the consumer's approval flow to the user's phone (via onBackchannelAuthRequest),
// user approves, client polls /token (grant_type=urn:openid:params:grant-type:ciba) and
// gets tokens. Poll mode only; ping + push come in a follow-up.

type TestUser = { sub: string };

const buildConfig = async (notifications: unknown[]) => {
	const signingKey = await generateSigningKey();

	const config: OidcProviderConfig<TestUser> = {
		authorizationCodeStore: createInMemoryAuthorizationCodeStore(),
		backchannelAuthStore: createInMemoryBackchannelAuthStore(),
		backchannelPollIntervalSeconds: 1,
		clientStore: createInMemoryOAuthClientStore([
			{
				clientId: 'partner-app',
				name: 'Partner',
				redirectUris: ['https://partner.example/cb'],
				scopes: ['openid', 'profile']
			}
		]),
		issuer: 'https://id.example.com',
		refreshTokenStore: createInMemoryOidcRefreshTokenStore(),
		signingKey,
		getUserId: (user) => user.sub,
		onBackchannelAuthRequest: (context) => {
			notifications.push(context);
		},
		resolveBackchannelUser: async ({ loginHint }) =>
			loginHint === 'alice@example.com' ? { sub: 'alice' } : undefined
	};

	return config;
};

describe('CIBA', () => {
	test('issueBackchannelAuth resolves the hint, fires the push hook, and returns auth_req_id', async () => {
		const notifications: unknown[] = [];
		const config = await buildConfig(notifications);

		const result = await issueBackchannelAuth({
			bindingMessage: 'ACME-1234',
			clientId: 'partner-app',
			config,
			loginHint: 'alice@example.com',
			requestedScopes: ['openid', 'profile']
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('unreachable');
		expect(result.auth_req_id.length).toBeGreaterThan(0);
		expect(result.expires_in).toBeGreaterThan(0);
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toMatchObject({
			authReqId: result.auth_req_id,
			bindingMessage: 'ACME-1234',
			clientId: 'partner-app',
			scopes: ['openid', 'profile'],
			userSub: 'alice'
		});
	});

	test('unknown login_hint returns unknown_user_id', async () => {
		const config = await buildConfig([]);
		const result = await issueBackchannelAuth({
			clientId: 'partner-app',
			config,
			loginHint: 'unknown@example.com',
			requestedScopes: ['openid']
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('unreachable');
		expect(result.error).toBe('unknown_user_id');
	});

	test('polling a pending auth returns authorization_pending; after approve returns tokens', async () => {
		const config = await buildConfig([]);
		const issued = await issueBackchannelAuth({
			clientId: 'partner-app',
			config,
			loginHint: 'alice@example.com',
			requestedScopes: ['openid']
		});
		if (!issued.ok) throw new Error('unreachable');

		const pending = await exchangeBackchannelAuth({
			authReqId: issued.auth_req_id,
			clientId: 'partner-app',
			config
		});
		expect(pending.ok).toBe(false);
		if (pending.ok) throw new Error('unreachable');
		expect(pending.error).toBe('authorization_pending');

		const approval = await approveBackchannelAuth({
			authReqId: issued.auth_req_id,
			config
		});
		expect(approval.ok).toBe(true);

		// Sleep past the per-poll interval (1s in this test config) so we don't trip slow_down.
		// eslint-disable-next-line promise/avoid-new -- short scheduler sleep to clear the poll-rate gate the previous exchange call recorded
		await new Promise<void>((resolve) => setTimeout(resolve, 1100));

		const tokens = await exchangeBackchannelAuth({
			authReqId: issued.auth_req_id,
			clientId: 'partner-app',
			config
		});
		expect(tokens.ok).toBe(true);
		if (!tokens.ok) throw new Error('unreachable');
		expect(tokens.access_token.length).toBeGreaterThan(0);
		expect(tokens.id_token.length).toBeGreaterThan(0);
		expect(tokens.refresh_token.length).toBeGreaterThan(0);
		expect(tokens.scope).toBe('openid');
	});

	test('denied auth returns access_denied at exchange', async () => {
		const config = await buildConfig([]);
		const issued = await issueBackchannelAuth({
			clientId: 'partner-app',
			config,
			loginHint: 'alice@example.com',
			requestedScopes: ['openid']
		});
		if (!issued.ok) throw new Error('unreachable');

		await denyBackchannelAuth({ authReqId: issued.auth_req_id, config });

		const result = await exchangeBackchannelAuth({
			authReqId: issued.auth_req_id,
			clientId: 'partner-app',
			config
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('unreachable');
		expect(result.error).toBe('access_denied');
	});

	test('polling faster than interval returns slow_down', async () => {
		const config = await buildConfig([]);
		const issued = await issueBackchannelAuth({
			clientId: 'partner-app',
			config,
			loginHint: 'alice@example.com',
			requestedScopes: ['openid']
		});
		if (!issued.ok) throw new Error('unreachable');

		const first = await exchangeBackchannelAuth({
			authReqId: issued.auth_req_id,
			clientId: 'partner-app',
			config
		});
		expect(first.ok).toBe(false);
		if (first.ok) throw new Error('unreachable');
		// First poll succeeds (returns pending) and records the timestamp; immediate second
		// poll should slow_down.
		const second = await exchangeBackchannelAuth({
			authReqId: issued.auth_req_id,
			clientId: 'partner-app',
			config
		});
		expect(second.ok).toBe(false);
		if (second.ok) throw new Error('unreachable');
		expect(second.error).toBe('slow_down');
	});

	test('grant type constant matches the spec value', () => {
		expect(CIBA_GRANT_TYPE).toBe('urn:openid:params:grant-type:ciba');
	});
});
