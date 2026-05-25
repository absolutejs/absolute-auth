import { describe, expect, spyOn, test } from 'bun:test';
import { evaluatePassword } from '../src/credentials/passwordPolicy';

describe('evaluatePassword', () => {
	test('rejects passwords below the minimum length', async () => {
		const result = await evaluatePassword('short', { minLength: 12 });

		expect(result.ok).toBe(false);
		expect(result.violations).toContain('too_short');
	});

	test('enforces complexity requirements', async () => {
		const result = await evaluatePassword('alllowercase', {
			minLength: 4,
			requireDigit: true,
			requireSymbol: true,
			requireUppercase: true
		});

		expect(result.violations).toContain('missing_uppercase');
		expect(result.violations).toContain('missing_digit');
		expect(result.violations).toContain('missing_symbol');
	});

	test('accepts a strong password', async () => {
		const result = await evaluatePassword('Str0ng-Passphrase!', {
			minLength: 12,
			requireDigit: true,
			requireLowercase: true,
			requireSymbol: true,
			requireUppercase: true
		});

		expect(result.ok).toBe(true);
		expect(result.violations).toHaveLength(0);
	});

	test('flags breached passwords via the HIBP range API', async () => {
		// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
		const spy = spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:42')
		);
		const result = await evaluatePassword('password', {
			checkBreaches: true,
			minLength: 1
		});

		expect(result.violations).toContain('breached');
		spy.mockRestore();
	});

	test('fails open when the HIBP API errors', async () => {
		const spy = spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('nope', { status: 500 })
		);
		const result = await evaluatePassword('password', {
			checkBreaches: true,
			minLength: 1
		});

		expect(result.violations).not.toContain('breached');
		spy.mockRestore();
	});
});
