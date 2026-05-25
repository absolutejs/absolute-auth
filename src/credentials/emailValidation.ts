import { resolveMx } from 'node:dns/promises';

// Email deliverability validation for sign-up — format, disposable-domain block, and an
// optional MX check. A starter disposable list ships built-in; extend it with your own.

export type EmailValidationResult = {
	ok: boolean;
	reason?: 'disposable' | 'invalid_format' | 'no_mx';
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const DISPOSABLE_DOMAINS = new Set([
	'10minutemail.com',
	'fakeinbox.com',
	'getnada.com',
	'guerrillamail.com',
	'mailinator.com',
	'maildrop.cc',
	'sharklasers.com',
	'temp-mail.org',
	'tempmail.com',
	'throwaway.email',
	'trashmail.com',
	'yopmail.com'
]);

const domainOf = (email: string) =>
	email.slice(email.lastIndexOf('@') + 1).toLowerCase();

const hasMxRecord = async (domain: string) => {
	try {
		return (await resolveMx(domain)).length > 0;
	} catch {
		return false;
	}
};

// Whether an email's domain is a known disposable/temporary provider (built-in list plus any
// `extraDomains` you pass).
export const isDisposableEmail = (
	email: string,
	extraDomains?: Iterable<string>
) => {
	const domain = domainOf(email);

	return (
		DISPOSABLE_DOMAINS.has(domain) ||
		(extraDomains !== undefined && new Set(extraDomains).has(domain))
	);
};

// Validate an email for sign-up. With `checkMx`, also confirms the domain has MX records
// (a network lookup). Wire it into your register flow before creating the user.
export const validateEmailDeliverability = async (
	email: string,
	options?: { checkMx?: boolean; disposableDomains?: Iterable<string> }
): Promise<EmailValidationResult> => {
	const normalized = email.trim().toLowerCase();
	if (!EMAIL_PATTERN.test(normalized)) {
		return { ok: false, reason: 'invalid_format' };
	}
	if (isDisposableEmail(normalized, options?.disposableDomains)) {
		return { ok: false, reason: 'disposable' };
	}
	if (options?.checkMx === true && !(await hasMxRecord(domainOf(normalized)))) {
		return { ok: false, reason: 'no_mx' };
	}

	return { ok: true };
};
