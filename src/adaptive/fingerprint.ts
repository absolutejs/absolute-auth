import { hashToken } from '../crypto';

// A dependency-light device fingerprint. The consumer collects client signals (see below) and
// this hashes them into a stable id for the adaptive engine's `deviceId` (its known-device +
// new_device signal) — a better default than a UA string alone, without a data network.
// Recommended signals to collect client-side (all optional): userAgent, language, timezone,
// platform, screen ("WxH"), colorDepth, and a canvas/WebGL hash. More distinct signals = a
// more stable, higher-entropy id. For data-network-grade detection (Stytch / WorkOS Radar),
// feed those scores in as extra signals or via the adaptive risk hooks.
export type DeviceSignals = Record<string, unknown>;

// Deterministic JSON: object keys sorted at every level (via the replacer), so the same
// signals hash identically regardless of the order the client sent them in.
const canonical = (signals: DeviceSignals) =>
	JSON.stringify(signals, (_key, value) =>
		value === null || typeof value !== 'object' || Array.isArray(value)
			? value
			: Object.fromEntries(
					Object.entries(value).sort((left, right) =>
						left[0].localeCompare(right[0])
					)
				)
	);

// Hash client device signals into a stable id (base64url SHA-256) for use as `deviceId`.
export const fingerprintDevice = (signals: DeviceSignals) =>
	hashToken(canonical(signals));
