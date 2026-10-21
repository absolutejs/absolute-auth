import { describe, expect, test } from 'bun:test';
import {
	renderOAuthConsentPage,
	renderOAuthStatusPage,
	oauthPageResponse
} from '../src/oidc/pages';
const brand = { logoPath: '/logo.svg', name: 'Example' };
const consent = {
	actionPath: '/oauth/consent',
	brand,
	clientName: 'Example client',
	fields: { csrf: 'secret' },
	permissions: ['Read your profile']
};
describe('OAuth connection pages', () => {
	test('escapes client, scope, branding, code and hidden form values', () => {
		const attack = '"><script>alert(1)</script>';
		const html = renderOAuthConsentPage({
			...consent,
			accountLabel: attack,
			brand: { name: attack },
			clientName: attack,
			fields: { return_to: attack },
			permissions: [attack],
			userCode: attack
		});
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('name="decision" value="approve"');
		expect(html).toContain('name="decision" value="deny"');
		expect(html).toContain('code matches');
	});
	test('rejects external, executable and ambiguous action URLs and decision collisions', () => {
		for (const href of [
			'https://evil.test',
			'//evil.test',
			'/\\evil.test',
			'javascript:alert(1)',
			'/\nevil.test'
		]) {
			expect(() =>
				renderOAuthConsentPage({ ...consent, actionPath: href })
			).toThrow();
			expect(() =>
				renderOAuthStatusPage({
					action: { href, label: 'Retry' },
					brand,
					state: 'error'
				})
			).toThrow();
			expect(() =>
				renderOAuthStatusPage({
					brand: { logoPath: href, name: 'Example' },
					state: 'error'
				})
			).toThrow();
		}
		expect(() =>
			renderOAuthConsentPage({
				...consent,
				fields: { decision: 'approve' }
			})
		).toThrow();
	});
	test('separates approval from verified connection and provides private script-free responses', async () => {
		const approved = renderOAuthStatusPage({
			brand,
			clientName: 'My app',
			state: 'approved'
		});
		expect(approved).toContain('Connection approved');
		expect(approved).not.toContain('You’re connected');
		expect(renderOAuthStatusPage({ brand, state: 'connected' })).toContain(
			'You’re connected'
		);
		expect(renderOAuthStatusPage({ brand, state: 'expired' })).toContain(
			'fresh link'
		);
		expect(renderOAuthStatusPage({ brand, state: 'denied' })).toContain(
			'not approved'
		);
		const response = oauthPageResponse(approved);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('referrer-policy')).toBe('strict-origin');
		expect(response.headers.get('content-security-policy')).toContain(
			"frame-ancestors 'none'"
		);
		expect(await response.text()).not.toContain('<script');
	});
});
