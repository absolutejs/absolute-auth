import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	kind: 'added',
	summary:
		'Allow a default authenticator label resolved from the signed-in user when the submitted name is blank. Preserve custom names and pending enrollments.',
	symbols: ['MfaConfig', 'mfaTotpRoutes']
};
