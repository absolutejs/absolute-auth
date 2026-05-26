import {
	MILLISECONDS_IN_A_MINUTE,
	MILLISECONDS_IN_AN_HOUR
} from '../constants';
import type {
	GeoPoint,
	KnownDeviceStore,
	LoginHistoryStore,
	RiskAction,
	RiskAssessment,
	RiskContext,
	RiskReason,
	RiskSignal,
	RiskThresholds,
	RiskWeights,
	WeightedRiskAssessment
} from './types';

const DEFAULT_HISTORY_LIMIT = 50;
const DEFAULT_MAX_TRAVEL_KMH = 900; // ~ a commercial jet; faster ⇒ impossible
const DEFAULT_VELOCITY_MAX_ATTEMPTS = 5;
const DEFAULT_VELOCITY_WINDOW_MINUTES = 5;
const DEFAULT_VELOCITY_WINDOW_MS =
	MILLISECONDS_IN_A_MINUTE * DEFAULT_VELOCITY_WINDOW_MINUTES;

const EARTH_RADIUS_KM = 6371;
const DEGREES_PER_HALF_TURN = 180;
const HALF = 2;

const ACTION_SEVERITY: Record<RiskAction, number> = {
	allow: 0,
	deny: 2,
	step_up: 1
};

const DEFAULT_RULE_ACTIONS: Record<RiskSignal, RiskAction> = {
	impossible_travel: 'deny',
	new_country: 'step_up',
	new_device: 'step_up',
	// off_hours/proxy only fire when the context supplies localHour/isProxy, so these defaults
	// are inert until you opt in by passing those fields.
	off_hours: 'allow',
	proxy: 'step_up',
	velocity: 'deny'
};

// Weighted-scoring defaults: tuned so any single high-signal (impossible_travel/velocity)
// reaches deny, two medium signals reach step-up. Override per deployment.
const DEFAULT_RISK_WEIGHTS: Record<RiskSignal, number> = {
	impossible_travel: 80,
	new_country: 25,
	new_device: 20,
	off_hours: 10,
	proxy: 30,
	velocity: 80
};

const DEFAULT_OFF_HOURS_START = 0;
const DEFAULT_OFF_HOURS_END = 6;
const DEFAULT_DENY_SCORE = 80;
const DEFAULT_STEP_UP_SCORE = 40;

// The opinionated risk engine. Pass the two stores and (optionally) override any
// rule's action or threshold. The package owns the rules + geo math; you own geo
// resolution (`RiskContext.geo`) and what to do with the verdict — wire
// `assessRisk` into your login / OAuth-callback flow where the request context
// (device, IP, geo) is available, then `recordAttempt` the outcome and
// `trustDevice` after a passed step-up.
export type AdaptiveConfig = {
	historyLimit?: number;
	knownDeviceStore: KnownDeviceStore;
	loginHistoryStore: LoginHistoryStore;
	maxTravelKmh?: number;
	// The local-hour window (user timezone) that counts as off-hours; default 0–6.
	offHours?: { end: number; start: number };
	rules?: Partial<Record<RiskSignal, RiskAction>>;
	velocityMaxAttempts?: number;
	velocityWindowMs?: number;
};

const toRadians = (degrees: number) =>
	(degrees * Math.PI) / DEGREES_PER_HALF_TURN;

// Great-circle distance between two points, in kilometres (haversine).
const haversineKm = (start: GeoPoint, end: GeoPoint) => {
	if (
		start.latitude === undefined ||
		start.longitude === undefined ||
		end.latitude === undefined ||
		end.longitude === undefined
	) {
		return undefined;
	}
	const deltaLat = toRadians(end.latitude - start.latitude);
	const deltaLon = toRadians(end.longitude - start.longitude);
	const sinLat = Math.sin(deltaLat / HALF);
	const sinLon = Math.sin(deltaLon / HALF);
	const factor =
		sinLat * sinLat +
		Math.cos(toRadians(start.latitude)) *
			Math.cos(toRadians(end.latitude)) *
			sinLon *
			sinLon;

	return HALF * EARTH_RADIUS_KM * Math.asin(Math.sqrt(factor));
};

const mostSevere = (reasons: RiskReason[]) =>
	reasons.reduce<RiskAction>(
		(worst, reason) =>
			ACTION_SEVERITY[reason.action] > ACTION_SEVERITY[worst]
				? reason.action
				: worst,
		'allow'
	);

const isWithinOffHours = (
	hour: number,
	range: { end: number; start: number } | undefined
) => {
	const start = range?.start ?? DEFAULT_OFF_HOURS_START;
	const end = range?.end ?? DEFAULT_OFF_HOURS_END;
	if (start <= end) return hour >= start && hour < end;

	return hour >= start || hour < end;
};

const actionForScore = (score: number, thresholds: RiskThresholds) => {
	const deny: RiskAction = 'deny';
	const stepUp: RiskAction = 'step_up';
	const allow: RiskAction = 'allow';
	if (score >= thresholds.deny) return deny;
	if (score >= thresholds.stepUp) return stepUp;

	return allow;
};

// The shared detection pass: which signals fired for this attempt. `assessRisk` (per-rule
// actions) and `scoreRisk` (weighted) both build on it. off_hours/proxy fire only when the
// context supplies localHour/isProxy.
const detectSignals = async (config: AdaptiveConfig, context: RiskContext) => {
	const {
		historyLimit = DEFAULT_HISTORY_LIMIT,
		knownDeviceStore,
		loginHistoryStore,
		maxTravelKmh = DEFAULT_MAX_TRAVEL_KMH,
		offHours,
		velocityMaxAttempts = DEFAULT_VELOCITY_MAX_ATTEMPTS,
		velocityWindowMs = DEFAULT_VELOCITY_WINDOW_MS
	} = config;
	const now = context.now ?? Date.now();
	const fired: RiskSignal[] = [];

	const [device, history] = await Promise.all([
		knownDeviceStore.findDevice(context.userId, context.deviceId),
		loginHistoryStore.listRecent(context.userId, historyLimit)
	]);

	if (device === undefined || !device.trusted) fired.push('new_device');

	const country = context.geo?.country;
	if (
		country !== undefined &&
		history.length > 0 &&
		!history.some((attempt) => attempt.country === country)
	) {
		fired.push('new_country');
	}

	const [previous] = history;
	const traveledKm =
		previous !== undefined && context.geo !== undefined
			? haversineKm(
					{
						latitude: previous.latitude,
						longitude: previous.longitude
					},
					context.geo
				)
			: undefined;
	const hours =
		previous === undefined
			? 0
			: (now - previous.timestamp) / MILLISECONDS_IN_AN_HOUR;
	if (
		traveledKm !== undefined &&
		hours > 0 &&
		traveledKm / hours > maxTravelKmh
	) {
		fired.push('impossible_travel');
	}

	const recentCount = history.filter(
		(attempt) => now - attempt.timestamp <= velocityWindowMs
	).length;
	if (recentCount >= velocityMaxAttempts) fired.push('velocity');

	if (context.isProxy === true) fired.push('proxy');
	if (
		context.localHour !== undefined &&
		isWithinOffHours(context.localHour, offHours)
	) {
		fired.push('off_hours');
	}

	return fired;
};

// Evaluate the built-in rules against an attempt and return the overall action
// (the most severe rule that fired) plus every reason.
export const assessRisk = async (
	config: AdaptiveConfig,
	context: RiskContext
): Promise<RiskAssessment> => {
	const actions: Record<RiskSignal, RiskAction> = {
		...DEFAULT_RULE_ACTIONS,
		...config.rules
	};
	const fired = await detectSignals(config, context);
	const reasons: RiskReason[] = fired.map((signal) => ({
		action: actions[signal],
		signal
	}));

	return { action: mostSevere(reasons), reasons };
};

export const createRiskEngine = (config: AdaptiveConfig) => ({
	assessRisk: (context: RiskContext) => assessRisk(config, context),
	recordAttempt: (context: RiskContext & { outcome: RiskAction }) =>
		recordLoginAttempt(config, context),
	scoreRisk: (
		context: RiskContext,
		options?: { thresholds?: RiskThresholds; weights?: RiskWeights }
	) => scoreRisk({ ...config, ...options }, context),
	trustDevice: (userId: string, deviceId: string, label?: string) =>
		trustDevice(config, userId, deviceId, label)
});
export const recordLoginAttempt = async (
	config: AdaptiveConfig,
	context: RiskContext & { outcome: RiskAction }
) => {
	const now = context.now ?? Date.now();
	const existing = await config.knownDeviceStore.findDevice(
		context.userId,
		context.deviceId
	);
	await config.knownDeviceStore.saveDevice({
		deviceId: context.deviceId,
		firstSeenAt: existing?.firstSeenAt ?? now,
		label: existing?.label,
		lastSeenAt: now,
		trusted: existing?.trusted ?? false,
		userId: context.userId
	});
	await config.loginHistoryStore.recordAttempt({
		attemptId: crypto.randomUUID(),
		country: context.geo?.country,
		deviceId: context.deviceId,
		ipAddress: context.ipAddress,
		latitude: context.geo?.latitude,
		longitude: context.geo?.longitude,
		outcome: context.outcome,
		timestamp: now,
		userId: context.userId
	});
};
// Weighted alternative to assessRisk: each fired signal adds its weight; the summed score
// maps to an action via thresholds (Auth0-style configurable scoring). Pass `weights` /
// `thresholds` to override the defaults.
export const scoreRisk = async (
	config: AdaptiveConfig & {
		thresholds?: RiskThresholds;
		weights?: RiskWeights;
	},
	context: RiskContext
): Promise<WeightedRiskAssessment> => {
	const weights: Record<RiskSignal, number> = {
		...DEFAULT_RISK_WEIGHTS,
		...config.weights
	};
	const defaultThresholds: RiskThresholds = {
		deny: DEFAULT_DENY_SCORE,
		stepUp: DEFAULT_STEP_UP_SCORE
	};
	const thresholds = config.thresholds ?? defaultThresholds;
	const fired = await detectSignals(config, context);
	const score = fired.reduce((sum, signal) => sum + weights[signal], 0);
	const action = actionForScore(score, thresholds);
	const reasons: RiskReason[] = fired.map((signal) => ({ action, signal }));

	return { action, reasons, score };
};
export const trustDevice = async (
	config: AdaptiveConfig,
	userId: string,
	deviceId: string,
	label?: string
) => {
	const now = Date.now();
	const existing = await config.knownDeviceStore.findDevice(userId, deviceId);
	await config.knownDeviceStore.saveDevice({
		deviceId,
		firstSeenAt: existing?.firstSeenAt ?? now,
		label: label ?? existing?.label,
		lastSeenAt: now,
		trusted: true,
		userId
	});
};
