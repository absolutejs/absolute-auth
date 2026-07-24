// Browser-side device fingerprint collector.
//
// `collectDeviceFingerprint()` reads ~10 signals from the browser (canvas render,
// AudioContext, WebGL renderer, font enumeration, screen geometry, navigator.languages,
// timezone, hardware concurrency, device memory, pixel ratio), normalizes them, and
// hashes the canonical JSON into a stable base64url SHA-256 `deviceId`.
//
// Self-hosted equivalent of FingerprintJS's open-source library. Each individual signal
// is weak on its own — but their combination is highly stable across sessions for the
// same browser+device, and varies sharply across different browsers/devices. The same
// algorithms underpin every commercial fingerprinter; only the proprietary data network
// (cross-customer reputation) is what SaaS vendors charge for, and that's a non-goal here.
//
// Imported via `@absolutejs/auth/fingerprint-client` — server bundle does NOT pull this in
// (browser globals like `window` would explode there). The client SDK + your sign-in form
// call this, send the result as `x-client-fingerprint`, and the server (riskConfig / adaptive)
// uses it as the deviceId instead of the weak UA+IP fallback.

const CANVAS_TEXT = 'absoluteAuth-fp 🔐';
const CANVAS_WIDTH = 280;
const CANVAS_HEIGHT = 60;
const AUDIO_SAMPLES_COUNT = 4500;
const AUDIO_OSC_FREQ = 10_000;
const AUDIO_COMPRESSOR_THRESHOLD = -50;
const AUDIO_COMPRESSOR_KNEE = 40;
const AUDIO_COMPRESSOR_RATIO = 12;
const AUDIO_COMPRESSOR_ATTACK = 0;
const AUDIO_COMPRESSOR_RELEASE = 0.25;
const AUDIO_SAMPLE_RATE = 44_100;
const FONT_PROBE = 'mmmmmmmmmlli';
const FONT_PROBE_PX = '72px';
const FONT_PROBE_OFFSCREEN_PX = -9999;
const FONT_BASE_FAMILIES = ['monospace', 'sans-serif', 'serif'] as const;
const POPULAR_FONTS = [
	'Arial',
	'Arial Black',
	'Comic Sans MS',
	'Courier New',
	'Georgia',
	'Helvetica',
	'Impact',
	'Lucida Console',
	'Times New Roman',
	'Trebuchet MS',
	'Verdana',
	'monospace',
	'sans-serif',
	'serif'
];

export type FingerprintSignals = {
	audio?: number;
	canvas?: string;
	deviceMemory?: number;
	fonts?: string[];
	hardwareConcurrency?: number;
	languages?: readonly string[];
	pixelRatio?: number;
	platform?: string;
	screen?: { colorDepth: number; height: number; width: number };
	timezone?: string;
	userAgent?: string;
	webgl?: { renderer?: string; vendor?: string };
};

export type DeviceFingerprint = {
	deviceId: string;
	signals: FingerprintSignals;
};

// Canvas hash: render text + a curve + a couple of rectangles + return the data URL
// (its pixel content hashes differently across GPUs, drivers, browser versions, font
// renderers). Wrapped in try/catch because privacy-mode browsers throw on getContext.
const readCanvas = () => {
	try {
		const canvas = document.createElement('canvas');
		canvas.width = CANVAS_WIDTH;
		canvas.height = CANVAS_HEIGHT;
		const context = canvas.getContext('2d');
		if (context === null) return undefined;
		context.textBaseline = 'top';
		context.font = '14px Arial';
		context.fillStyle = '#f60';
		context.fillRect(125, 1, 62, 20);
		context.fillStyle = '#069';
		context.fillText(CANVAS_TEXT, 2, 15);
		context.fillStyle = 'rgba(102, 204, 0, 0.7)';
		context.fillText(CANVAS_TEXT, 4, 17);

		return canvas.toDataURL();
	} catch {
		return undefined;
	}
};

const isOfflineAudioContextCtor = (
	value: unknown
): value is typeof OfflineAudioContext => typeof value === 'function';

const resolveOfflineAudioContextCtor = () => {
	if (typeof OfflineAudioContext !== 'undefined') return OfflineAudioContext;
	const legacy: unknown = Reflect.get(
		globalThis,
		'webkitOfflineAudioContext'
	);

	return isOfflineAudioContextCtor(legacy) ? legacy : undefined;
};

const sumAbs = (samples: Float32Array) => {
	let total = 0;
	for (const sample of samples) total += Math.abs(sample);

	return total;
};

// Audio hash: instantiate an offline audio context, push a brief oscillator + dynamics
// compressor through it, read back the rendered buffer's sum. Different audio stacks
// produce subtly different floating-point outputs.
const readAudio = async () => {
	try {
		const ContextCtor = resolveOfflineAudioContextCtor();
		if (ContextCtor === undefined) return undefined;
		const context = new ContextCtor(
			1,
			AUDIO_SAMPLES_COUNT,
			AUDIO_SAMPLE_RATE
		);
		const oscillator = context.createOscillator();
		oscillator.type = 'triangle';
		oscillator.frequency.value = AUDIO_OSC_FREQ;
		const compressor = context.createDynamicsCompressor();
		compressor.threshold.value = AUDIO_COMPRESSOR_THRESHOLD;
		compressor.knee.value = AUDIO_COMPRESSOR_KNEE;
		compressor.ratio.value = AUDIO_COMPRESSOR_RATIO;
		// `reduction` is read-only on the modern spec (the constant exists for the
		// outdated browsers that originally exposed it as a writable AudioParam;
		// we don't bother setting it — the fingerprint is plenty stable without).
		compressor.attack.value = AUDIO_COMPRESSOR_ATTACK;
		compressor.release.value = AUDIO_COMPRESSOR_RELEASE;
		oscillator.connect(compressor);
		compressor.connect(context.destination);
		oscillator.start(0);
		const buffer = await context.startRendering();

		return sumAbs(buffer.getChannelData(0));
	} catch {
		return undefined;
	}
};

// WebGL hash: the renderer + vendor strings include GPU model + driver — highly stable,
// highly distinctive. Behind the WEBGL_debug_renderer_info extension on most browsers.
const readWebgl = () => {
	try {
		const canvas = document.createElement('canvas');
		const context =
			canvas.getContext('webgl') ??
			canvas.getContext('experimental-webgl');
		if (
			context === null ||
			!('getExtension' in context) ||
			!('getParameter' in context)
		) {
			return undefined;
		}
		const debug = context.getExtension('WEBGL_debug_renderer_info');
		if (debug === null) return undefined;

		return {
			renderer: String(
				context.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? ''
			),
			vendor: String(
				context.getParameter(debug.UNMASKED_VENDOR_WEBGL) ?? ''
			)
		};
	} catch {
		return undefined;
	}
};

// Width of `probe` rendered in `family` on the given span — used to detect installed
// fonts (different widths than the fallback ⇒ font is present).
const measureFamily = (span: HTMLSpanElement, family: string) => {
	span.style.fontFamily = family;

	return span.offsetWidth;
};

const detectFontPresent = (
	span: HTMLSpanElement,
	font: string,
	baseline: Record<string, number>
) =>
	FONT_BASE_FAMILIES.some(
		(family) =>
			measureFamily(span, `'${font}', ${family}`) !== baseline[family]
	);

// Font enumeration: a font is "installed" if the rendered width of a probe string differs
// from the same string in a known fallback. Compares against monospace + sans-serif +
// serif and counts a match if any of them produce a different width.
const readFonts = () => {
	try {
		const span = document.createElement('span');
		span.style.position = 'absolute';
		span.style.left = `${FONT_PROBE_OFFSCREEN_PX}px`;
		span.style.fontSize = FONT_PROBE_PX;
		span.textContent = FONT_PROBE;
		document.body.appendChild(span);

		const baseline: Record<string, number> = Object.fromEntries(
			FONT_BASE_FAMILIES.map((family) => [
				family,
				measureFamily(span, family)
			])
		);
		const present = POPULAR_FONTS.filter((font) =>
			detectFontPresent(span, font, baseline)
		);

		document.body.removeChild(span);

		return present;
	} catch {
		return undefined;
	}
};

const readScreen = () => {
	if (typeof screen === 'undefined') return undefined;

	return {
		colorDepth: screen.colorDepth,
		height: screen.height,
		width: screen.width
	};
};

const readTimezone = () => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	} catch {
		return undefined;
	}
};

// Canonical JSON identical to the server-side `fingerprintDevice` canonicalizer: keys
// sorted at every depth so identical signals produce identical hashes regardless of
// insertion order. Inlined here to keep the client bundle free of server-side imports.
const canonical = (signals: FingerprintSignals) =>
	JSON.stringify(signals, (_key, value) =>
		value === null || typeof value !== 'object' || Array.isArray(value)
			? value
			: Object.fromEntries(
					Object.entries(value).sort((left, right) =>
						left[0].localeCompare(right[0])
					)
				)
	);

const sha256Base64Url = async (input: string) => {
	const bytes = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(input)
	);
	const binary = String.fromCharCode(...new Uint8Array(bytes));

	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
};

// Collect every signal we can, hash them, return both so the caller can persist the raw
// signals (for debugging / drift detection) while sending just the deviceId on the wire.
export const collectDeviceFingerprint =
	async (): Promise<DeviceFingerprint> => {
		if (typeof window === 'undefined' || typeof document === 'undefined') {
			throw new Error(
				'collectDeviceFingerprint must run in a browser — server-side use the @absolutejs/auth fingerprintDevice helper instead'
			);
		}
		const [canvas, audio, webgl, fonts] = await Promise.all([
			Promise.resolve(readCanvas()),
			readAudio(),
			Promise.resolve(readWebgl()),
			Promise.resolve(readFonts())
		]);

		const deviceMemory =
			'deviceMemory' in navigator
				? Reflect.get(navigator, 'deviceMemory')
				: undefined;
		const signals: FingerprintSignals = {
			audio,
			canvas,
			deviceMemory:
				typeof deviceMemory === 'number' ? deviceMemory : undefined,
			fonts,
			hardwareConcurrency: navigator.hardwareConcurrency,
			languages: navigator.languages,
			pixelRatio: window.devicePixelRatio,
			platform: navigator.platform,
			screen: readScreen(),
			timezone: readTimezone(),
			userAgent: navigator.userAgent,
			webgl
		};

		return { deviceId: await sha256Base64Url(canonical(signals)), signals };
	};
