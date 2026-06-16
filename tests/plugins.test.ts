import { afterEach, describe, expect, test } from 'bun:test';
import {
	denyDisposableEmailPlugin,
	discordAlertPlugin,
	geoBlockPlugin,
	pagerdutyAlertPlugin,
	posthogIdentifyPlugin,
	slackAlertPlugin
} from '../src/plugins';
import type { AuditEvent } from '../src/audit/types';

type RecordedRequest = {
	body: unknown;
	url: string;
};

const originalFetch = globalThis.fetch;

const installFetchSpy = () => {
	const recorded: RecordedRequest[] = [];
	globalThis.fetch = (async (url: string, init: RequestInit) => {
		recorded.push({
			body: JSON.parse(String(init.body ?? '{}')),
			url
		});

		return new Response(null, { status: 200 });
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal fetch stub
	}) as any;

	return recorded;
};

afterEach(() => {
	globalThis.fetch = originalFetch;
});

const sampleEvent: AuditEvent = {
	at: 1779834344276,
	ip: '24.146.180.236',
	metadata: { email: 'alice@example.com' },
	type: 'credentials_login',
	userId: 'user-alice'
};

describe('plugin: slackAlertPlugin', () => {
	test('posts a one-liner to the webhook for every event when no filter is set', async () => {
		const recorded = installFetchSpy();
		const sink = slackAlertPlugin({ webhookUrl: 'https://hooks.slack/x' });
		await sink.append(sampleEvent);
		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.url).toBe('https://hooks.slack/x');
		expect((recorded[0]?.body as { text: string }).text).toContain(
			'credentials_login'
		);
	});

	test('events allow-list filters non-matching types', async () => {
		const recorded = installFetchSpy();
		const sink = slackAlertPlugin({
			events: ['credentials_login_failed'],
			webhookUrl: 'https://hooks.slack/x'
		});
		await sink.append(sampleEvent);
		expect(recorded).toHaveLength(0);
	});
});

describe('plugin: discordAlertPlugin', () => {
	test('posts content body to webhook', async () => {
		const recorded = installFetchSpy();
		const sink = discordAlertPlugin({ webhookUrl: 'https://discord/x' });
		await sink.append(sampleEvent);
		expect((recorded[0]?.body as { content: string }).content).toContain(
			'credentials_login'
		);
	});
});

describe('plugin: pagerdutyAlertPlugin', () => {
	test('triggers a PagerDuty event with the configured routing key + severity', async () => {
		const recorded = installFetchSpy();
		const sink = pagerdutyAlertPlugin({
			events: ['credentials_login'],
			routingKey: 'INTEGRATION_KEY_XYZ',
			severity: 'critical'
		});
		await sink.append(sampleEvent);
		expect(recorded[0]?.url).toContain('events.pagerduty.com');
		const body = recorded[0]?.body as {
			event_action: string;
			payload: { severity: string; summary: string };
			routing_key: string;
		};
		expect(body.event_action).toBe('trigger');
		expect(body.routing_key).toBe('INTEGRATION_KEY_XYZ');
		expect(body.payload.severity).toBe('critical');
		expect(body.payload.summary).toContain('credentials_login');
	});
});

describe('plugin: denyDisposableEmailPlugin', () => {
	test('allows a real email', async () => {
		const decision = await denyDisposableEmailPlugin('alice@example.com');
		expect(decision.allow).toBe(true);
	});

	test('blocks a known disposable email', async () => {
		const decision = await denyDisposableEmailPlugin('test@mailinator.com');
		expect(decision.allow).toBe(false);
		if (!decision.allow) expect(decision.reason).toBe('disposable_email');
	});
});

describe('plugin: geoBlockPlugin', () => {
	test('allow-list: blocks when country is not in the list', () => {
		const check = geoBlockPlugin({ allowCountries: ['US', 'CA'] });
		expect(check({ 'x-client-country': 'DE' })).toBe(true);
		expect(check({ 'x-client-country': 'US' })).toBe(false);
	});

	test('deny-list: blocks when country is on it', () => {
		const check = geoBlockPlugin({ denyCountries: ['RU', 'KP'] });
		expect(check({ 'x-client-country': 'RU' })).toBe(true);
		expect(check({ 'x-client-country': 'US' })).toBe(false);
	});

	test('reads cf-ipcountry as a fallback when x-client-country is missing', () => {
		const check = geoBlockPlugin({ denyCountries: ['CN'] });
		expect(check({ 'cf-ipcountry': 'CN' })).toBe(true);
	});

	test('returns false (no block) when country is unknown', () => {
		const check = geoBlockPlugin({ denyCountries: ['RU'] });
		expect(check({})).toBe(false);
	});
});

describe('plugin: posthogIdentifyPlugin', () => {
	test('posts an $identify event with the configured project key', async () => {
		const recorded = installFetchSpy();
		const sink = posthogIdentifyPlugin({
			projectApiKey: 'phc_TEST'
		});
		await sink.append(sampleEvent);
		expect(recorded[0]?.url).toContain('us.i.posthog.com');
		const body = recorded[0]?.body as {
			api_key: string;
			distinct_id: string;
			event: string;
			properties: { $set: Record<string, unknown> };
		};
		expect(body.api_key).toBe('phc_TEST');
		expect(body.distinct_id).toBe('user-alice');
		expect(body.event).toBe('$identify');
		expect(body.properties.$set.email).toBe('alice@example.com');
	});

	test('skips events without a userId', async () => {
		const recorded = installFetchSpy();
		const sink = posthogIdentifyPlugin({ projectApiKey: 'phc_TEST' });
		await sink.append({
			at: Date.now(),
			type: 'authorization_denied'
		});
		expect(recorded).toHaveLength(0);
	});
});
