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
	RiskSignal
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
	velocity: 'deny'
};

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

// Evaluate the built-in rules against an attempt and return the overall action
// (the most severe rule that fired) plus every reason.
export const assessRisk = async (
	config: AdaptiveConfig,
	context: RiskContext
): Promise<RiskAssessment> => {
	const {
		historyLimit = DEFAULT_HISTORY_LIMIT,
		knownDeviceStore,
		loginHistoryStore,
		maxTravelKmh = DEFAULT_MAX_TRAVEL_KMH,
		rules,
		velocityMaxAttempts = DEFAULT_VELOCITY_MAX_ATTEMPTS,
		velocityWindowMs = DEFAULT_VELOCITY_WINDOW_MS
	} = config;
	const now = context.now ?? Date.now();
	const actions: Record<RiskSignal, RiskAction> = {
		...DEFAULT_RULE_ACTIONS,
		...rules
	};
	const reasons: RiskReason[] = [];

	const [device, history] = await Promise.all([
		knownDeviceStore.findDevice(context.userId, context.deviceId),
		loginHistoryStore.listRecent(context.userId, historyLimit)
	]);

	if (device === undefined || !device.trusted) {
		reasons.push({ action: actions.new_device, signal: 'new_device' });
	}

	const country = context.geo?.country;
	if (
		country !== undefined &&
		history.length > 0 &&
		!history.some((attempt) => attempt.country === country)
	) {
		reasons.push({ action: actions.new_country, signal: 'new_country' });
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
		reasons.push({
			action: actions.impossible_travel,
			signal: 'impossible_travel'
		});
	}

	const recentCount = history.filter(
		(attempt) => now - attempt.timestamp <= velocityWindowMs
	).length;
	if (recentCount >= velocityMaxAttempts) {
		reasons.push({ action: actions.velocity, signal: 'velocity' });
	}

	return { action: mostSevere(reasons), reasons };
};
export const createRiskEngine = (config: AdaptiveConfig) => ({
	assessRisk: (context: RiskContext) => assessRisk(config, context),
	recordAttempt: (context: RiskContext & { outcome: RiskAction }) =>
		recordLoginAttempt(config, context),
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
