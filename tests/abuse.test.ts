import { describe, expect, mock, test } from 'bun:test';
import {
	verifyHcaptcha,
	verifyRecaptcha,
	verifyTurnstile
} from '../src/abuse/captcha';
import {
	assessAbuse,
	createAbuseGuard,
	defaultBotClassifier,
	type AbuseConfig
} from '../src/abuse/config';

describe('abuse guard', () => {
	test('a clean request is allowed', async () => {
		const result = await assessAbuse({}, { ip: '203.0.113.5' });
		expect(result).toEqual({ action: 'allow', reasons: [] });
	});

	test('denies a listed IP and an IPv4 CIDR range', async () => {
		const config: AbuseConfig = { ipDeny: ['10.0.0.0/8', '203.0.113.7'] };

		expect((await assessAbuse(config, { ip: '10.4.5.6' })).action).toBe(
			'deny'
		);
		expect((await assessAbuse(config, { ip: '203.0.113.7' })).action).toBe(
			'deny'
		);
		expect((await assessAbuse(config, { ip: '203.0.113.8' })).action).toBe(
			'allow'
		);
	});

	test('allow-list short-circuits and blocks everything else', async () => {
		const config: AbuseConfig = { ipAllow: ['192.168.1.0/24'] };

		expect((await assessAbuse(config, { ip: '192.168.1.50' })).action).toBe(
			'allow'
		);
		const blocked = await assessAbuse(config, { ip: '8.8.8.8' });
		expect(blocked.action).toBe('deny');
		expect(blocked.reasons[0]?.signal).toBe('not_allowlisted');
	});

	test('a failing CAPTCHA denies (configurable action)', async () => {
		const config: AbuseConfig = {
			captchaAction: 'challenge',
			verifyCaptcha: (token) => token === 'good'
		};

		expect(
			(await assessAbuse(config, { captchaToken: 'good' })).action
		).toBe('allow');
		const bad = await assessAbuse(config, { captchaToken: 'bad' });
		expect(bad.action).toBe('challenge');
		expect(bad.reasons[0]?.signal).toBe('captcha_failed');
	});

	test('classifyBot denies non-humans; the default heuristic flags bot UAs', async () => {
		const config: AbuseConfig = { classifyBot: defaultBotClassifier };

		expect(
			(await assessAbuse(config, { userAgent: 'curl/8.4.0' })).action
		).toBe('deny');
		expect(
			(
				await assessAbuse(config, {
					userAgent: 'Mozilla/5.0 (Macintosh)'
				})
			).action
		).toBe('allow');
		expect(defaultBotClassifier({ userAgent: 'Googlebot/2.1' })).toBe(
			'crawler'
		);
		expect(defaultBotClassifier({})).toBe('bot');
	});

	test('most severe action wins across signals', async () => {
		const result = await assessAbuse(
			{ ipDeny: ['1.2.3.4'], verifyCaptcha: () => false },
			{ captchaToken: 'x', ip: '1.2.3.4' }
		);
		expect(result.action).toBe('deny');
		expect(result.reasons.length).toBeGreaterThan(1);
	});

	test('createAbuseGuard binds the config', async () => {
		const guard = createAbuseGuard({ ipDeny: ['9.9.9.9'] });
		expect((await guard.assess({ ip: '9.9.9.9' })).action).toBe('deny');
	});
});

describe('captcha adapters', () => {
	const stubFetch = (payload: object) => {
		const original = globalThis.fetch;
		globalThis.fetch = mock(
			async () => new Response(JSON.stringify(payload))
			// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test stub for fetch
		) as unknown as typeof fetch;

		return () => {
			globalThis.fetch = original;
		};
	};

	test('turnstile passes on success and fails otherwise', async () => {
		const restore = stubFetch({ success: true });
		try {
			const verify = verifyTurnstile({ secret: 'sk' });
			expect(await verify('tok', { ip: '1.2.3.4' })).toBe(true);
			expect(await verify(undefined, {})).toBe(false); // missing token
		} finally {
			restore();
		}
	});

	test('turnstile fails on success:false', async () => {
		const restore = stubFetch({ success: false });
		try {
			const verify = verifyTurnstile({ secret: 'sk' });
			expect(await verify('tok', {})).toBe(false);
		} finally {
			restore();
		}
	});

	test('recaptcha enforces the v3 minScore', async () => {
		const restore = stubFetch({ score: 0.3, success: true });
		try {
			const verify = verifyRecaptcha({ minScore: 0.5, secret: 'sk' });
			expect(await verify('tok', {})).toBe(false); // 0.3 < 0.5
		} finally {
			restore();
		}
	});

	test('hcaptcha passes on success', async () => {
		const restore = stubFetch({ success: true });
		try {
			const verify = verifyHcaptcha({ secret: 'sk' });
			expect(await verify('tok', {})).toBe(true);
		} finally {
			restore();
		}
	});
});
