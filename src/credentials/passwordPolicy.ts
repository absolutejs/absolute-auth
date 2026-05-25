export type PasswordPolicy = {
	checkBreaches?: boolean;
	minLength?: number;
	requireDigit?: boolean;
	requireLowercase?: boolean;
	requireSymbol?: boolean;
	requireUppercase?: boolean;
};

export type PasswordPolicyViolation =
	| 'breached'
	| 'missing_digit'
	| 'missing_lowercase'
	| 'missing_symbol'
	| 'missing_uppercase'
	| 'too_short';

export type PasswordPolicyResult = {
	ok: boolean;
	violations: PasswordPolicyViolation[];
};

const DEFAULT_MIN_LENGTH = 12;
const HEX_RADIX = 16;
const HIBP_PREFIX_LENGTH = 5;
const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';

const sha1Hex = async (input: string) => {
	const digest = await crypto.subtle.digest(
		'SHA-1',
		new TextEncoder().encode(input)
	);

	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(HEX_RADIX).padStart(2, '0'))
		.join('')
		.toUpperCase();
};

// HaveIBeenPwned k-anonymity: only the first 5 hash chars leave the process, never
// the password. Fails open (returns false) so a HIBP outage never blocks sign-up.
const isPasswordBreached = async (password: string) => {
	try {
		const hash = await sha1Hex(password);
		const prefix = hash.slice(0, HIBP_PREFIX_LENGTH);
		const suffix = hash.slice(HIBP_PREFIX_LENGTH);
		const response = await fetch(`${HIBP_RANGE_URL}${prefix}`);
		if (!response.ok) return false;

		const body = await response.text();

		return body
			.split('\n')
			.some((line) => line.split(':')[0]?.trim() === suffix);
	} catch {
		return false;
	}
};

export const evaluatePassword = async (
	password: string,
	policy: PasswordPolicy = {}
): Promise<PasswordPolicyResult> => {
	const minLength = policy.minLength ?? DEFAULT_MIN_LENGTH;
	const violations: PasswordPolicyViolation[] = [];

	if (password.length < minLength) {
		violations.push('too_short');
	}
	if (policy.requireUppercase && !/[A-Z]/u.test(password)) {
		violations.push('missing_uppercase');
	}
	if (policy.requireLowercase && !/[a-z]/u.test(password)) {
		violations.push('missing_lowercase');
	}
	if (policy.requireDigit && !/\d/u.test(password)) {
		violations.push('missing_digit');
	}
	if (policy.requireSymbol && !/[^A-Za-z0-9]/u.test(password)) {
		violations.push('missing_symbol');
	}
	if (policy.checkBreaches && (await isPasswordBreached(password))) {
		violations.push('breached');
	}

	return { ok: violations.length === 0, violations };
};
