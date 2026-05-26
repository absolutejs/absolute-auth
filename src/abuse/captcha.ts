import type { AbuseContext } from './config';

// CAPTCHA verifier factories for the abuse guard's `verifyCaptcha` hook. Each returns a
// (token, context) => Promise<boolean> that POSTs to the provider's siteverify endpoint with
// your secret + the client token (and remoteip from context.ip). A missing/invalid token
// fails; a network error fails to false (the guard then applies its captchaAction).

const TURNSTILE_URL =
	'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RECAPTCHA_URL = 'https://www.google.com/recaptcha/api/siteverify';
const HCAPTCHA_URL = 'https://api.hcaptcha.com/siteverify';

const readField = (data: unknown, key: string) => {
	if (typeof data !== 'object' || data === null) return undefined;
	const value: unknown = Reflect.get(data, key);

	return value;
};

const siteverify = async (
	url: string,
	secret: string,
	token: string,
	context: AbuseContext
) => {
	const body = new URLSearchParams({ response: token, secret });
	if (context.ip !== undefined) body.set('remoteip', context.ip);
	const response = await fetch(url, { body, method: 'POST' });
	const data: unknown = await response.json();

	return data;
};

// hCaptcha.
export const verifyHcaptcha =
	({ secret }: { secret: string }) =>
	async (token: string | undefined, context: AbuseContext) => {
		if (token === undefined || token === '') return false;
		try {
			const data = await siteverify(HCAPTCHA_URL, secret, token, context);

			return readField(data, 'success') === true;
		} catch {
			return false;
		}
	};

// Google reCAPTCHA. Pass `minScore` (e.g. 0.5) to also enforce the v3 score.
export const verifyRecaptcha =
	({ minScore, secret }: { minScore?: number; secret: string }) =>
	async (token: string | undefined, context: AbuseContext) => {
		if (token === undefined || token === '') return false;
		try {
			const data = await siteverify(RECAPTCHA_URL, secret, token, context);
			if (readField(data, 'success') !== true) return false;
			if (minScore === undefined) return true;
			const score = readField(data, 'score');

			return typeof score === 'number' && score >= minScore;
		} catch {
			return false;
		}
	};

// Cloudflare Turnstile.
export const verifyTurnstile =
	({ secret }: { secret: string }) =>
	async (token: string | undefined, context: AbuseContext) => {
		if (token === undefined || token === '') return false;
		try {
			const data = await siteverify(TURNSTILE_URL, secret, token, context);

			return readField(data, 'success') === true;
		} catch {
			return false;
		}
	};
