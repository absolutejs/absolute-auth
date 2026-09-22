import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	kind: 'breaking',
	migration: {
		instruction:
			'Run the mfa migration block before upgrading servers. Custom MFAStore implementations must add atomic claimCodeAttempt, completeCodeChallenge, and resetCodeAttempts methods. Handle HTTP 429 mfa_rate_limited responses with Retry-After and retryAfterMs. Recovery codes are opaque strings, not fixed eight-character values.'
	},
	summary:
		'Replace permanent MFA lockouts with durable timed attempt budgets, independent recovery-code limits, and atomic recovery-code consumption. Previously locked accounts can authenticate again.',
	symbols: ['MFAStore', 'mfaChallenge', 'MfaConfig']
};
