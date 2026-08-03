import { describe, expect, test } from 'bun:test';
import { isSafeLocalPath, toSafeLocalPath } from '../src/redirect';

// Regression guard for the open-redirect class where a same-origin check
// rejects '//' but accepts '/\evil.com'. Browsers normalize backslashes to
// forward slashes, so '/\evil.com' resolves to the protocol-relative
// '//evil.com'. These helpers back the SAML RelayState + OIDC/authorize
// referer redirect sanitizers.
describe('safe local redirect paths', () => {
	test('accepts genuine same-origin paths', () => {
		for (const path of [
			'/',
			'/admin/deployments',
			'/portal/dashboard?tab=x',
			'/a#b',
			'/x?next=//not-an-origin'
		]) {
			expect(isSafeLocalPath(path)).toBe(true);
			expect(toSafeLocalPath(path)).toBe(path);
		}
	});

	test('rejects protocol-relative, backslash, and absolute targets', () => {
		for (const path of [
			'//evil.com',
			'/\\evil.com',
			'/\\\\evil.com',
			'\\/evil.com',
			'\\\\evil.com',
			'https://evil.com',
			'http://evil.com',
			'javascript:alert(1)',
			'evil.com',
			''
		]) {
			expect(isSafeLocalPath(path)).toBe(false);
			expect(toSafeLocalPath(path)).toBe('/');
		}
	});

	test('falls back for undefined and honors a custom fallback', () => {
		expect(toSafeLocalPath(undefined)).toBe('/');
		expect(toSafeLocalPath('//evil.com', '/home')).toBe('/home');
		expect(toSafeLocalPath('/ok', '/home')).toBe('/ok');
	});
});
