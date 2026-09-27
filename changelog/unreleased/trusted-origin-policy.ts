import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	kind: 'added',
	summary:
		'`trustedOrigins` also accepts a function of the request, so a multi-tenant app can decide per request (for example, allow only the request’s own origin) instead of listing every origin up front.',
	symbols: [
		'createAuthApplications',
		'CredentialsConfig',
		'isTrustedOrigin',
		'oidcProviderRoutes',
		'resolveOriginAllowed',
		'TrustedOriginPolicy'
	]
};
