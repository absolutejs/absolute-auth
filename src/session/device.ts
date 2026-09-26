// A readable device label from a User-Agent: "Chrome on Windows". Deliberately coarse —
// it helps people recognize their own sessions, it isn't fingerprinting.
const browsers: [RegExp, string][] = [
	[/\bEdg(?:e|A|iOS)?\//, 'Edge'],
	[/\bOPR\/|\bOpera\b/, 'Opera'],
	[/\bSamsungBrowser\//, 'Samsung Internet'],
	[/\bFirefox\/|\bFxiOS\//, 'Firefox'],
	[/\bCriOS\/|\bChrome\//, 'Chrome'],
	[/\bSafari\//, 'Safari']
];
const systems: [RegExp, string][] = [
	[/\biPhone\b|\biPad\b|\biPod\b/, 'iOS'],
	[/\bAndroid\b/, 'Android'],
	[/\bCrOS\b/, 'ChromeOS'],
	[/\bWindows\b/, 'Windows'],
	[/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
	[/\bLinux\b/, 'Linux']
];

const firstMatch = (value: string, table: [RegExp, string][]) =>
	table.find(([pattern]) => pattern.test(value))?.[1];

export const describeUserAgent = (userAgent?: string) => {
	if (!userAgent) return undefined;
	const browser = firstMatch(userAgent, browsers);
	const system = firstMatch(userAgent, systems);
	if (!browser && !system) return undefined;

	return { browser, os: system };
};
