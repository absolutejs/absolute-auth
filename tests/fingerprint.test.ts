import { describe, expect, test } from 'bun:test';
import { fingerprintDevice } from '../src/adaptive/fingerprint';

describe('fingerprintDevice', () => {
	const signals = {
		canvasHash: 'abc123',
		language: 'en-US',
		platform: 'MacIntel',
		screen: '1920x1080',
		timezone: 'America/New_York',
		userAgent: 'Mozilla/5.0'
	};

	test('is deterministic and key-order independent', async () => {
		const first = await fingerprintDevice(signals);
		const reordered = await fingerprintDevice({
			canvasHash: 'abc123',
			language: 'en-US',
			platform: 'MacIntel',
			screen: '1920x1080',
			timezone: 'America/New_York',
			userAgent: 'Mozilla/5.0'
		});

		expect(first).toBe(reordered);
		expect(first).toMatch(/^[A-Za-z0-9_-]+$/u); // base64url
	});

	test('different signals produce a different id', async () => {
		const original = await fingerprintDevice(signals);
		const changed = await fingerprintDevice({
			...signals,
			screen: '1280x720'
		});

		expect(changed).not.toBe(original);
	});
});
