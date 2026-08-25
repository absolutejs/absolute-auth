import { describe, expect, test } from 'bun:test';
import {
	createMobileAuthClient,
	createMobileAuthTransport,
	MobileAuthError
} from '../src/client/mobile';
import { createAuthClient } from '../src/client/createAuthClient';
import { generateSigningKey, signJwt, toPublicJwk } from '../src/oidc/keys';

const ISSUER = 'https://auth.example';
const API_ORIGIN = 'https://api.example';
const REDIRECT_URI = 'com.example.app:/oauth/callback';

const waitFor: (
	condition: () => boolean,
	attempts?: number
) => Promise<void> = (condition, attempts = 100) => {
	if (condition()) return Promise.resolve();
	if (attempts <= 0)
		return Promise.reject(new Error('Timed out waiting for test state.'));

	return new Promise((resolve) => setTimeout(resolve, 0)).then(() =>
		waitFor(condition, attempts - 1)
	);
};

const setup = async (options: { secure?: boolean } = {}) => {
	const signingKey = await generateSigningKey();
	const values = new Map<string, string>();
	const opened: string[] = [];
	const authorizations: string[] = [];
	let linkListener: ((url: string) => void) | undefined;
	let currentTime = 1_800_000_000_000;
	let authorizeNonce = '';
	let refreshes = 0;
	let refreshLocks = 0;
	let apiCalls = 0;
	const fetchImpl: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		if (url.pathname === '/.well-known/openid-configuration')
			return Response.json({
				authorization_endpoint: `${ISSUER}/oauth2/authorize`,
				code_challenge_methods_supported: ['S256'],
				issuer: ISSUER,
				jwks_uri: `${ISSUER}/oauth2/jwks`,
				revocation_endpoint: `${ISSUER}/oauth2/revoke`,
				socket_ticket_endpoint: `${ISSUER}/oauth2/socket-ticket`,
				token_endpoint: `${ISSUER}/oauth2/token`,
				token_endpoint_auth_methods_supported: ['none'],
				userinfo_endpoint: `${ISSUER}/oauth2/userinfo`
			});
		if (url.pathname === '/oauth2/jwks')
			return Response.json({ keys: [toPublicJwk(signingKey)] });
		if (url.pathname === '/oauth2/token') {
			const body = new URLSearchParams(await request.text());
			const isRefresh = body.get('grant_type') === 'refresh_token';
			if (isRefresh) refreshes += 1;
			const idToken = await signJwt(
				{
					aud: 'mobile-client',
					exp: Math.floor((currentTime + 60_000) / 1000),
					iat: Math.floor(currentTime / 1000),
					iss: ISSUER,
					...(isRefresh ? {} : { nonce: authorizeNonce }),
					sub: 'user-alice'
				},
				signingKey
			);

			return Response.json({
				access_token: isRefresh ? 'access-2' : 'access-1',
				expires_in: 60,
				id_token: idToken,
				refresh_token: isRefresh ? 'refresh-2' : 'refresh-1',
				scope: 'openid profile',
				token_type: 'Bearer'
			});
		}
		if (url.origin === API_ORIGIN) {
			apiCalls += 1;
			authorizations.push(request.headers.get('authorization') ?? '');

			return Response.json({ ok: true });
		}
		if (url.pathname === '/oauth2/userinfo') {
			authorizations.push(request.headers.get('authorization') ?? '');

			return Response.json({ name: 'Alice', sub: 'user-alice' });
		}
		if (url.pathname === '/oauth2/socket-ticket') {
			authorizations.push(request.headers.get('authorization') ?? '');
			const body: unknown = await request.json();
			const audience =
				typeof body === 'object' && body !== null
					? Reflect.get(body, 'audience')
					: undefined;

			return Response.json({ ticket: `ticket:${String(audience)}` });
		}
		if (url.pathname === '/oauth2/revoke') return new Response(null);

		return new Response(null, { status: 404 });
	};
	const client = createMobileAuthClient({
		allowedOrigins: [ISSUER, API_ORIGIN],
		clientId: 'mobile-client',
		fetch: fetchImpl,
		issuer: ISSUER,
		links: {
			getLaunchUrl: async () => null,
			onOpen: async (listener) => {
				linkListener = listener;

				return () => {
					linkListener = undefined;
				};
			},
			openExternal: async (url) => {
				opened.push(url);
				authorizeNonce = new URL(url).searchParams.get('nonce') ?? '';
			}
		},
		redirectUri: REDIRECT_URI,
		storage: {
			capability: async () => ({
				available: options.secure ?? true,
				message: 'secure storage unavailable'
			}),
			get: async (key) => values.get(key) ?? null,
			remove: async (key) => {
				values.delete(key);
			},
			set: async (key, value) => {
				values.set(key, value);
			},
			withLock: async (_key, run) => {
				refreshLocks += 1;

				return run();
			}
		},
		now: () => currentTime
	});

	return {
		authorizations,
		client,
		opened,
		values,
		advance: (milliseconds: number) => {
			currentTime += milliseconds;
		},
		apiCalls: () => apiCalls,
		emitLink: (url: string) => linkListener?.(url),
		refreshes: () => refreshes,
		refreshLocks: () => refreshLocks
	};
};

const completeSignIn = async (fixture: Awaited<ReturnType<typeof setup>>) => {
	const result = fixture.client.signIn();
	await waitFor(() => fixture.opened.length === 1);
	const [openedUrl] = fixture.opened;
	if (!openedUrl) throw new Error('Expected the system authorization URL.');
	const authorization = new URL(openedUrl);
	const state = authorization.searchParams.get('state');
	const callback = `${REDIRECT_URI}?code=one-use-code&iss=${encodeURIComponent(ISSUER)}&state=${encodeURIComponent(state ?? '')}`;
	const handled = await fixture.client.handleCallback(callback);

	return { authorization, handled, result: await result };
};

describe('mobile auth client', () => {
	test('uses external-browser S256 PKCE and persists only the refresh credential', async () => {
		const fixture = await setup();
		const { authorization, handled, result } =
			await completeSignIn(fixture);

		expect(authorization.searchParams.get('code_challenge_method')).toBe(
			'S256'
		);
		expect(authorization.searchParams.get('response_type')).toBe('code');
		expect(authorization.searchParams.get('redirect_uri')).toBe(
			REDIRECT_URI
		);
		expect(handled.accessToken).toBe('access-1');
		expect(result.refreshToken).toBe('refresh-1');
		expect(fixture.values.get('oidc.refresh')).toBe('refresh-1');
		expect(fixture.values.has('oidc.pending')).toBe(false);
		expect([...fixture.values.values()]).not.toContain('access-1');
		expect([...fixture.values.values()]).not.toContain(result.idToken);
	});

	test('serializes refresh rotation across concurrent authenticated requests', async () => {
		const fixture = await setup();
		await completeSignIn(fixture);
		fixture.advance(40_000);

		const responses = await Promise.all([
			fixture.client.fetch(`${API_ORIGIN}/account`),
			fixture.client.fetch(`${API_ORIGIN}/profile`)
		]);
		expect(responses.every((response) => response.ok)).toBe(true);
		expect(fixture.refreshes()).toBe(1);
		expect(fixture.refreshLocks()).toBe(1);
		expect(fixture.apiCalls()).toBe(2);
		expect(fixture.authorizations.slice(-2)).toEqual([
			'Bearer access-2',
			'Bearer access-2'
		]);
		expect(fixture.values.get('oidc.refresh')).toBe('refresh-2');
	});

	test('can fetch public app data before the user signs in', async () => {
		const fixture = await setup();
		const response = await fixture.client.fetchOptional(
			`${API_ORIGIN}/public`
		);
		expect(response.ok).toBe(true);
		expect(fixture.authorizations.at(-1)).toBe('');
		expect(fixture.refreshes()).toBe(0);
	});

	test('maps unchanged Auth client routes to the canonical backend', async () => {
		const fixture = await setup();
		const authClient = createAuthClient({
			transport: createMobileAuthTransport(fixture.client, {
				baseUrl: API_ORIGIN
			})
		});
		expect(
			await authClient.passwordReset.request({
				email: 'alice@example.com'
			})
		).toEqual({ data: { ok: true }, error: null });
		expect(fixture.authorizations.at(-1)).toBe('');
	});

	test('never sends a bearer credential outside registered origins', async () => {
		const fixture = await setup();
		await completeSignIn(fixture);

		await expect(
			fixture.client.fetch('https://attacker.example/collect')
		).rejects.toEqual(
			expect.objectContaining<Partial<MobileAuthError>>({
				code: 'origin'
			})
		);
	});

	test('fetches a bearer-authenticated socket ticket for Sync', async () => {
		const fixture = await setup();
		await completeSignIn(fixture);
		await expect(
			fixture.client.socketTicket('https://api.example/sync')
		).resolves.toBe('ticket:https://api.example/sync');
		expect(fixture.authorizations.at(-1)).toBe('Bearer access-1');
	});

	test('derives and publishes an opaque Sync namespace from verified userinfo', async () => {
		const fixture = await setup();
		const namespaces: Array<string | null> = [];
		const remove = fixture.client.onPrincipalChange((principal) =>
			namespaces.push(principal?.namespace ?? null)
		);
		await completeSignIn(fixture);
		const first = await fixture.client.principal();
		const second = await fixture.client.principal();

		expect(first).toEqual(second);
		expect(first).toEqual(
			expect.objectContaining({
				issuer: ISSUER,
				subject: 'user-alice'
			})
		);
		expect(first?.namespace).toStartWith('auth:v1:');
		expect(first?.namespace).not.toContain('user-alice');
		expect(namespaces).toEqual([first?.namespace]);

		await fixture.client.signOut();
		expect(namespaces).toEqual([first?.namespace, null]);
		remove();
	});

	test('refuses to start when native secure storage is unavailable', async () => {
		const fixture = await setup({ secure: false });

		await expect(fixture.client.signIn()).rejects.toEqual(
			expect.objectContaining<Partial<MobileAuthError>>({
				code: 'secure-storage'
			})
		);
		expect(fixture.opened).toEqual([]);
	});

	test('rejects callback mix-up before exchanging a code', async () => {
		const fixture = await setup();
		const result = fixture.client.signIn();
		void result.catch(() => undefined);
		await waitFor(() => fixture.opened.length === 1);
		const [openedUrl] = fixture.opened;
		if (!openedUrl)
			throw new Error('Expected the system authorization URL.');
		const state = new URL(openedUrl).searchParams.get('state');

		await expect(
			fixture.client.handleCallback(
				`${REDIRECT_URI}?code=code&iss=${encodeURIComponent(ISSUER)}&state=${state}-wrong`
			)
		).rejects.toEqual(
			expect.objectContaining<Partial<MobileAuthError>>({
				code: 'callback'
			})
		);
		await expect(result).rejects.toEqual(
			expect.objectContaining<Partial<MobileAuthError>>({
				code: 'callback'
			})
		);
	});
});
