import { expect, test } from 'bun:test';
import { installSessionExpiryGuard } from '../src/client/sessionExpiry';

const withBrowser = async (
	fetcher: typeof fetch,
	run: (
		redirects: string[],
		browser: { fetch: typeof fetch }
	) => Promise<void>
) => {
	const previousWindow = Object.getOwnPropertyDescriptor(
		globalThis,
		'window'
	);
	const previousDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		'document'
	);
	const redirects: string[] = [];
	const browser = Object.assign(new EventTarget(), {
		fetch: fetcher,
		location: {
			href: 'https://app.example/admin/people',
			origin: 'https://app.example',
			assign: (url: string) => redirects.push(url)
		}
	});
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: browser
	});
	Object.defineProperty(globalThis, 'document', {
		configurable: true,
		value: Object.assign(new EventTarget(), { visibilityState: 'visible' })
	});
	try {
		await run(redirects, browser);
	} finally {
		installSessionExpiryGuard().dispose();
		if (previousWindow)
			Object.defineProperty(globalThis, 'window', previousWindow);
		else Reflect.deleteProperty(globalThis, 'window');
		if (previousDocument)
			Object.defineProperty(globalThis, 'document', previousDocument);
		else Reflect.deleteProperty(globalThis, 'document');
	}
};

test('recent-authentication 401 keeps the valid session and original response', async () => {
	const calls: string[] = [];
	await withBrowser(
		async (input) => {
			calls.push(String(input));

			return String(input) === '/oauth2/status'
				? Response.json({ user: { sub: 'admin' } })
				: new Response('Recent authentication required', {
						status: 401
					});
		},
		async (redirects, browser) => {
			installSessionExpiryGuard({ protectedPaths: ['/v1/'] });
			const response = await browser.fetch('/v1/impersonation/start', {
				method: 'POST'
			});
			expect(response.status).toBe(401);
			expect(await response.text()).toBe(
				'Recent authentication required'
			);
			expect(redirects).toEqual([]);
			expect(calls).toEqual([
				'/v1/impersonation/start',
				'/oauth2/status'
			]);
		}
	);
});

test('confirmed expiry redirects once and preserves the return location', async () => {
	await withBrowser(
		async (input) =>
			String(input) === '/oauth2/status'
				? Response.json({ user: null })
				: new Response('Unauthorized', { status: 401 }),
		async (redirects, browser) => {
			installSessionExpiryGuard({ protectedPaths: ['/v1/'] });
			await browser.fetch('/v1/accounts/me');
			await browser.fetch('/v1/profiles/me');
			expect(redirects).toEqual([
				'/signin?reason=session_expired&returnUrl=%2Fadmin%2Fpeople'
			]);
		}
	);
});

test('failed status checks do not turn a recoverable 401 into a forced logout', async () => {
	await withBrowser(
		async (input) => {
			if (String(input) === '/oauth2/status')
				throw new TypeError('offline');

			return new Response('Verify your identity', { status: 401 });
		},
		async (redirects, browser) => {
			installSessionExpiryGuard({ protectedPaths: ['/v1/'] });
			expect(
				(await browser.fetch('/v1/impersonation/start')).status
			).toBe(401);
			expect(redirects).toEqual([]);
		}
	);
});

test('unprotected and third-party failures do not check or expire this session', async () => {
	const calls: string[] = [];
	await withBrowser(
		async (input) => {
			calls.push(String(input));

			return new Response('Unauthorized', { status: 401 });
		},
		async (redirects, browser) => {
			installSessionExpiryGuard({ protectedPaths: ['/v1/'] });
			await browser.fetch('/auth/login');
			await browser.fetch('https://other.example/v1/private');
			expect(calls).toHaveLength(2);
			expect(redirects).toEqual([]);
		}
	);
});
