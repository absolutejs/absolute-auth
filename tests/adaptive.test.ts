import { beforeEach, describe, expect, test } from 'bun:test';
import {
	assessRisk,
	createRiskEngine,
	recordLoginAttempt,
	scoreRisk,
	trustDevice,
	type AdaptiveConfig
} from '../src/adaptive/config';
import {
	createInMemoryKnownDeviceStore,
	createInMemoryLoginHistoryStore
} from '../src/adaptive/inMemoryStores';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const buildConfig = (overrides?: Partial<AdaptiveConfig>): AdaptiveConfig => ({
	knownDeviceStore: createInMemoryKnownDeviceStore(),
	loginHistoryStore: createInMemoryLoginHistoryStore(),
	...overrides
});

describe('assessRisk', () => {
	let config = buildConfig();

	beforeEach(() => {
		config = buildConfig();
	});

	test('an unknown device triggers a step_up', async () => {
		const assessment = await assessRisk(config, {
			deviceId: 'dev-1',
			userId: 'user-1'
		});

		expect(assessment.action).toBe('step_up');
		expect(assessment.reasons.map((reason) => reason.signal)).toContain(
			'new_device'
		);
	});

	test('a trusted device with no other signals is allowed', async () => {
		await trustDevice(config, 'user-1', 'dev-1');

		const assessment = await assessRisk(config, {
			deviceId: 'dev-1',
			userId: 'user-1'
		});
		expect(assessment.action).toBe('allow');
		expect(assessment.reasons).toEqual([]);
	});

	test('a new country triggers a step_up', async () => {
		await trustDevice(config, 'user-1', 'dev-1');
		await recordLoginAttempt(config, {
			deviceId: 'dev-1',
			geo: { country: 'US' },
			outcome: 'allow',
			userId: 'user-1'
		});

		const assessment = await assessRisk(config, {
			deviceId: 'dev-1',
			geo: { country: 'FR' },
			userId: 'user-1'
		});
		expect(assessment.reasons.map((reason) => reason.signal)).toContain(
			'new_country'
		);
		expect(assessment.action).toBe('step_up');
	});

	test('impossible travel is denied', async () => {
		const now = Date.now();
		await trustDevice(config, 'user-1', 'dev-1');
		await recordLoginAttempt(config, {
			deviceId: 'dev-1',
			// New York
			geo: { country: 'US', latitude: 40.71, longitude: -74.0 },
			now: now - HOUR_MS,
			outcome: 'allow',
			userId: 'user-1'
		});

		const assessment = await assessRisk(config, {
			deviceId: 'dev-1',
			// Tokyo, one hour later — physically impossible
			geo: { country: 'JP', latitude: 35.68, longitude: 139.69 },
			now,
			userId: 'user-1'
		});
		expect(assessment.reasons.map((reason) => reason.signal)).toContain(
			'impossible_travel'
		);
		expect(assessment.action).toBe('deny');
	});

	test('attempt velocity is denied', async () => {
		const now = Date.now();
		await trustDevice(config, 'user-1', 'dev-1');
		for (let index = 0; index < 5; index += 1) {
			// eslint-disable-next-line no-await-in-loop -- sequential history seeding
			await recordLoginAttempt(config, {
				deviceId: 'dev-1',
				now: now - index * 1000,
				outcome: 'allow',
				userId: 'user-1'
			});
		}

		const assessment = await assessRisk(config, {
			deviceId: 'dev-1',
			now,
			userId: 'user-1'
		});
		expect(assessment.reasons.map((reason) => reason.signal)).toContain(
			'velocity'
		);
		expect(assessment.action).toBe('deny');
	});

	test('per-signal action overrides are honored', async () => {
		const lenient = buildConfig({ rules: { new_device: 'allow' } });

		const assessment = await assessRisk(lenient, {
			deviceId: 'dev-x',
			userId: 'user-1'
		});
		expect(assessment.action).toBe('allow');
	});
});

describe('scoreRisk (weighted)', () => {
	let config = buildConfig();

	beforeEach(() => {
		config = buildConfig();
	});

	test('a single low-weight signal stays below step-up', async () => {
		const result = await scoreRisk(config, {
			deviceId: 'dev-1',
			userId: 'user-1'
		});
		expect(result.score).toBe(20); // new_device weight
		expect(result.action).toBe('allow');
	});

	test('new country + proxy sums across the step-up threshold', async () => {
		await trustDevice(config, 'user-1', 'dev-1');
		await recordLoginAttempt(config, {
			deviceId: 'dev-1',
			geo: { country: 'US' },
			outcome: 'allow',
			userId: 'user-1'
		});

		const result = await scoreRisk(config, {
			deviceId: 'dev-1',
			geo: { country: 'FR' },
			isProxy: true,
			userId: 'user-1'
		});
		expect(result.score).toBe(55); // new_country 25 + proxy 30
		expect(result.action).toBe('step_up');
		expect(result.reasons.map((reason) => reason.signal).sort()).toEqual([
			'new_country',
			'proxy'
		]);
	});

	test('a high-weight signal reaches deny', async () => {
		const now = Date.now();
		await trustDevice(config, 'user-1', 'dev-1');
		await recordLoginAttempt(config, {
			deviceId: 'dev-1',
			geo: { country: 'US', latitude: 40.71, longitude: -74.0 },
			now: now - HOUR_MS,
			outcome: 'allow',
			userId: 'user-1'
		});

		const result = await scoreRisk(config, {
			deviceId: 'dev-1',
			geo: { country: 'JP', latitude: 35.68, longitude: 139.69 },
			now,
			userId: 'user-1'
		});
		expect(result.score).toBeGreaterThanOrEqual(80);
		expect(result.action).toBe('deny');
	});

	test('off_hours fires only when localHour is in the window', async () => {
		await trustDevice(config, 'user-1', 'dev-1');

		const atNight = await scoreRisk(config, {
			deviceId: 'dev-1',
			localHour: 3,
			userId: 'user-1'
		});
		expect(atNight.reasons.map((reason) => reason.signal)).toContain(
			'off_hours'
		);

		const daytime = await scoreRisk(config, {
			deviceId: 'dev-1',
			localHour: 14,
			userId: 'user-1'
		});
		expect(daytime.reasons.map((reason) => reason.signal)).not.toContain(
			'off_hours'
		);
	});

	test('custom weights + thresholds override the defaults', async () => {
		const result = await scoreRisk(
			{
				...config,
				thresholds: { deny: 100, stepUp: 10 },
				weights: { new_device: 15 }
			},
			{ deviceId: 'dev-1', userId: 'user-1' }
		);
		expect(result.score).toBe(15);
		expect(result.action).toBe('step_up');
	});

	test('engine.scoreRisk is bound to the config', async () => {
		const engine = createRiskEngine(buildConfig());
		const result = await engine.scoreRisk({
			deviceId: 'dev-1',
			userId: 'user-1'
		});
		expect(result.score).toBe(20);
		expect(result.action).toBe('allow');
	});
});

describe('createRiskEngine', () => {
	test('binds the config across assess/record/trust', async () => {
		const engine = createRiskEngine(buildConfig());

		const first = await engine.assessRisk({
			deviceId: 'dev-1',
			userId: 'user-1'
		});
		expect(first.action).toBe('step_up');

		await engine.trustDevice('user-1', 'dev-1', 'Laptop');
		const second = await engine.assessRisk({
			deviceId: 'dev-1',
			userId: 'user-1'
		});
		expect(second.action).toBe('allow');

		await engine.recordAttempt({
			deviceId: 'dev-1',
			outcome: 'allow',
			userId: 'user-1'
		});
	});
});
