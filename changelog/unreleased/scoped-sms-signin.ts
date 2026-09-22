import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	kind: 'breaking',
	migration: {
		instruction:
			'Run mfa/0008_scoped_sms_challenges before rollout. Custom MFAStore implementations must implement getSmsChallengeStore with durable atomic state per user, pending session, and factor, and support the sms_send attempt budget. SMS codes issued by old servers must be requested again after upgrading.',
		manual: true
	},
	summary:
		'Isolate SMS sign-in codes and resend cooldowns by pending session and phone. Preserve concurrent users codes and return structured resend timing. Keep a separate account delivery budget (default ten attempts per five minutes).',
	symbols: ['MFAStore', 'MfaConfig', 'mfaChallenge']
};
