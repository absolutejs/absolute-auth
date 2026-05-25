// Bot / abuse protection — the framework half of WorkOS "Radar" (which is hosted-only).
// The package owns the decision pipeline (IP allow/deny + CAPTCHA + bot classification ->
// allow / challenge / deny); you own the signals via hooks: a `verifyCaptcha` wrapping
// Turnstile/reCAPTCHA/hCaptcha, and a `classifyBot` (or the built-in UA heuristic). Pairs
// with the adaptive risk engine — run both at the top of register/login.

export type AbuseAction = 'allow' | 'challenge' | 'deny';

export type AbuseSignal =
	| 'blocked_ip'
	| 'bot'
	| 'captcha_failed'
	| 'not_allowlisted';

export type BotClass = 'agent' | 'bot' | 'crawler' | 'human';

export type AbuseContext = {
	captchaToken?: string;
	ip?: string;
	userAgent?: string;
};

export type AbuseReason = {
	action: AbuseAction;
	signal: AbuseSignal;
};

export type AbuseAssessment = {
	action: AbuseAction;
	reasons: AbuseReason[];
};

export type AbuseConfig = {
	// Action when `classifyBot` returns a non-human class (default 'deny').
	botAction?: AbuseAction;
	// Action when `verifyCaptcha` fails (default 'deny').
	captchaAction?: AbuseAction;
	// Classify the caller. Defaults to no classification; pass `defaultBotClassifier` for a
	// User-Agent heuristic, or your own (e.g. an AI-agent detector).
	classifyBot?: (context: AbuseContext) => BotClass | Promise<BotClass>;
	// Exact IPs or IPv4 CIDRs that are always allowed through (skips the remaining checks).
	ipAllow?: string[];
	// Exact IPs or IPv4 CIDRs that are always denied.
	ipDeny?: string[];
	// Verify a CAPTCHA token (wrap your provider). Returns true to pass. When set, a missing
	// or invalid token fails.
	verifyCaptcha?: (
		token: string | undefined,
		context: AbuseContext
	) => boolean | Promise<boolean>;
};

const IPV4_BITS = 32;
const IPV4_OCTET_SPACE = 256;
const FULL_MASK = -1;

const ACTION_SEVERITY: Record<AbuseAction, number> = {
	allow: 0,
	challenge: 1,
	deny: 2
};

const BOT_PATTERN =
	/bot|crawl|spider|curl|wget|python-requests|headless|scrapy/iu;
const CRAWLER_PATTERN = /googlebot|bingbot|duckduckbot|baiduspider|yandex/iu;

const ipv4ToInt = (ipAddress: string) =>
	ipAddress
		.split('.')
		.reduce((acc, octet) => acc * IPV4_OCTET_SPACE + Number(octet), 0) >>> 0;

const matchCidrV4 = (ipAddress: string, cidr: string) => {
	const [range, bitsRaw] = cidr.split('/');
	const bits = Number(bitsRaw);
	if (range === undefined || !Number.isInteger(bits) || !ipAddress.includes('.')) {
		return false;
	}
	const mask = bits === 0 ? 0 : (FULL_MASK << (IPV4_BITS - bits)) >>> 0;

	return (ipv4ToInt(ipAddress) & mask) === (ipv4ToInt(range) & mask);
};

const ipInList = (ipAddress: string, list: string[]) =>
	list.some((entry) =>
		entry.includes('/') ? matchCidrV4(ipAddress, entry) : entry === ipAddress
	);

const mostSevere = (reasons: AbuseReason[]) =>
	reasons.reduce<AbuseAction>(
		(worst, reason) =>
			ACTION_SEVERITY[reason.action] > ACTION_SEVERITY[worst]
				? reason.action
				: worst,
		'allow'
	);

// Run the abuse checks for one attempt. Returns the most severe action that fired plus every
// reason. An allow-listed IP short-circuits to 'allow'.
export const assessAbuse = async (
	config: AbuseConfig,
	context: AbuseContext
): Promise<AbuseAssessment> => {
	const ipAddress = context.ip;

	if (
		ipAddress !== undefined &&
		config.ipAllow !== undefined &&
		config.ipAllow.length > 0 &&
		ipInList(ipAddress, config.ipAllow)
	) {
		return { action: 'allow', reasons: [] };
	}

	const reasons: AbuseReason[] = [];

	if (
		ipAddress !== undefined &&
		config.ipDeny !== undefined &&
		ipInList(ipAddress, config.ipDeny)
	) {
		reasons.push({ action: 'deny', signal: 'blocked_ip' });
	}
	if (
		ipAddress !== undefined &&
		config.ipAllow !== undefined &&
		config.ipAllow.length > 0 &&
		!ipInList(ipAddress, config.ipAllow)
	) {
		reasons.push({ action: 'deny', signal: 'not_allowlisted' });
	}

	const captchaPassed =
		config.verifyCaptcha === undefined ||
		(await config.verifyCaptcha(context.captchaToken, context));
	if (!captchaPassed) {
		reasons.push({
			action: config.captchaAction ?? 'deny',
			signal: 'captcha_failed'
		});
	}

	const botClass =
		config.classifyBot === undefined
			? 'human'
			: await config.classifyBot(context);
	if (botClass !== 'human') {
		reasons.push({ action: config.botAction ?? 'deny', signal: 'bot' });
	}

	return { action: mostSevere(reasons), reasons };
};

// DX wrapper: bind the config once.
export const createAbuseGuard = (config: AbuseConfig) => ({
	assess: (context: AbuseContext) => assessAbuse(config, context)
});

// A dependency-light User-Agent heuristic. Real fingerprint-grade detection (WorkOS's edge)
// needs a data network — pass your own `classifyBot` for that; this catches the obvious cases.
export const defaultBotClassifier = (context: AbuseContext) => {
	const userAgent = context.userAgent ?? '';
	if (userAgent.trim() === '') return 'bot';
	if (CRAWLER_PATTERN.test(userAgent)) return 'crawler';
	if (BOT_PATTERN.test(userAgent)) return 'bot';

	return 'human';
};
