const EMAIL_DOMAIN_LABEL_MAX_LENGTH = 63;
const EMAIL_LOCAL_PART_MAX_LENGTH = 64;
const EMAIL_TOTAL_MAX_LENGTH = 320;

const EMAIL_LOCAL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const DOMAIN_LABEL_RE = /^[a-z0-9-]+$/;

const toAsciiDomain = (domain: string) => {
	try {
		return new URL(`https://${domain}`).hostname.toLowerCase();
	} catch {
		return '';
	}
};

export const normalizeEmailAddress = (value: string) => {
	const trimmed = value.trim();
	const atIndex = trimmed.lastIndexOf('@');
	if (
		atIndex <= 0 ||
		atIndex !== trimmed.indexOf('@') ||
		atIndex === trimmed.length - 1
	) {
		return null;
	}

	const local = trimmed.slice(0, atIndex).toLowerCase();
	const rawDomain = trimmed.slice(atIndex + 1);
	if (/[\s/\\?#:%]/u.test(rawDomain)) return null;
	const domain = toAsciiDomain(rawDomain);
	if (
		!local ||
		!domain ||
		local.length > EMAIL_LOCAL_PART_MAX_LENGTH ||
		trimmed.length > EMAIL_TOTAL_MAX_LENGTH
	) {
		return null;
	}
	if (
		!EMAIL_LOCAL_RE.test(local) ||
		local.startsWith('.') ||
		local.endsWith('.') ||
		local.includes('..')
	) {
		return null;
	}

	const labels = domain.split('.');
	if (labels.length < 2) return null;
	if (
		labels.some(
			(label) =>
				label.length === 0 ||
				label.length > EMAIL_DOMAIN_LABEL_MAX_LENGTH ||
				label.startsWith('-') ||
				label.endsWith('-') ||
				!DOMAIN_LABEL_RE.test(label)
		)
	) {
		return null;
	}

	const tld = labels[labels.length - 1];
	if (!tld || (!/^[a-z]{2,}$/.test(tld) && !tld.startsWith('xn--'))) {
		return null;
	}

	const normalized = `${local}@${domain}`;

	return normalized.length <= EMAIL_TOTAL_MAX_LENGTH ? normalized : null;
};
