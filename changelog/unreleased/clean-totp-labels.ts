import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	kind: 'fixed',
	summary: 'Use the chosen method name in TOTP QR account labels instead of internal user and factor identifiers. Preserve existing secrets and factor IDs.',
	symbols: ['mfaTotpRoutes']
};
