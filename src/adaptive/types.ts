// What an assessment tells the caller to do. Ordered by severity in the engine:
// allow < step_up < deny.
export type RiskAction = 'allow' | 'deny' | 'step_up';

// The built-in rules. Each maps to a `RiskAction` (overridable per deployment).
// `off_hours` and `proxy` only fire when the context supplies `localHour` / `isProxy`.
export type RiskSignal =
	| 'impossible_travel'
	| 'new_country'
	| 'new_device'
	| 'off_hours'
	| 'proxy'
	| 'velocity';

// A geo position the consumer resolves from the request IP. The package bundles
// no GeoIP database — pass what your edge / a lookup gives you (any field may be
// omitted; rules that need a field simply don't fire without it).
export type GeoPoint = {
	country?: string;
	latitude?: number;
	longitude?: number;
};

// The context of one authentication attempt to assess. `isProxy` (from your edge / an IP
// intelligence lookup) drives the `proxy` signal; `localHour` (0–23 in the user's timezone,
// which you compute) drives the `off_hours` signal.
export type RiskContext = {
	deviceId: string;
	geo?: GeoPoint;
	ipAddress?: string;
	isProxy?: boolean;
	localHour?: number;
	now?: number;
	userId: string;
};

// One fired rule and the action it contributed.
export type RiskReason = {
	action: RiskAction;
	signal: RiskSignal;
};

// The overall decision (the most severe fired action) plus every reason.
export type RiskAssessment = {
	action: RiskAction;
	reasons: RiskReason[];
};

// Weighted-scoring mode: each fired signal contributes its weight; the summed score maps to
// an action via thresholds. An alternative to the per-rule actions of `assessRisk`.
export type RiskWeights = Partial<Record<RiskSignal, number>>;

export type RiskThresholds = {
	deny: number;
	stepUp: number;
};

export type WeightedRiskAssessment = {
	action: RiskAction;
	reasons: RiskReason[];
	score: number;
};

// A device seen for a user. `trusted` (set after a successful step-up — the
// "remember this device" UX) suppresses the new_device signal next time.
export type KnownDevice = {
	deviceId: string;
	firstSeenAt: number;
	label?: string;
	lastSeenAt: number;
	trusted: boolean;
	userId: string;
};

export type KnownDeviceStore = {
	findDevice: (
		userId: string,
		deviceId: string
	) => Promise<KnownDevice | undefined>;
	listDevices: (userId: string) => Promise<KnownDevice[]>;
	saveDevice: (device: KnownDevice) => Promise<void>;
};

// A recorded authentication attempt — the history the rules read.
export type LoginAttempt = {
	attemptId: string;
	country?: string;
	deviceId: string;
	ipAddress?: string;
	latitude?: number;
	longitude?: number;
	outcome: RiskAction;
	timestamp: number;
	userId: string;
};

export type LoginHistoryStore = {
	listRecent: (userId: string, limit: number) => Promise<LoginAttempt[]>;
	recordAttempt: (attempt: LoginAttempt) => Promise<void>;
};
