import { describe, expect, test } from 'bun:test';
import {
	buildSessionExpiredSignInUrl,
	isProtectedSessionRequest
} from '../src/client/sessionExpiry';

describe('session expiry guard', () => {
	test('builds a sign-in URL that preserves the current route', () => {
		expect(
			buildSessionExpiredSignInUrl({
				currentHref:
					'https://app.example/portal/matches?stage=active#candidate-7'
			})
		).toBe(
			'/signin?reason=session_expired&returnUrl=%2Fportal%2Fmatches%3Fstage%3Dactive%23candidate-7'
		);
	});

	test('supports custom sign-in and query parameter names', () => {
		expect(
			buildSessionExpiredSignInUrl({
				currentHref: 'https://app.example/admin/people',
				reasonParam: 'cause',
				returnUrlParam: 'next',
				signInPath: '/login?tenant=acme'
			})
		).toBe(
			'/login?tenant=acme&cause=session_expired&next=%2Fadmin%2Fpeople'
		);
	});

	test('matches only configured same-origin protected paths', () => {
		const origin = 'https://app.example';
		const protectedPaths = ['/v1/'];

		expect(
			isProtectedSessionRequest({
				input: '/v1/profiles/me',
				origin,
				protectedPaths
			})
		).toBe(true);
		expect(
			isProtectedSessionRequest({
				input: 'https://uploads.example/v1/files',
				origin,
				protectedPaths
			})
		).toBe(false);
		expect(
			isProtectedSessionRequest({
				input: '/oauth2/status',
				origin,
				protectedPaths
			})
		).toBe(false);
	});
});
