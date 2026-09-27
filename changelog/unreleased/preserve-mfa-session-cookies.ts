import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	kind: 'fixed',
	summary:
		'Preserve pending MFA login cookies during authentication-status and protected-route checks. Read-only session resolution no longer expires browser cookies, preventing delayed unauthenticated responses from erasing a newer login. Expired server sessions are still removed, and pending sessions remain unauthenticated.',
	symbols: ['protectRoutePlugin', 'requireAuthPlugin']
};
