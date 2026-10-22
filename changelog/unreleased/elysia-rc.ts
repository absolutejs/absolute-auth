import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "Elysia 2.0.0-rc.0 renamed every lifecycle hook to its `on` form and removed `setup`/`cleanup`. auth's peer range accepted it (`^2.0.0-beta.6`), so an app that installed the newer Elysia got an auth that called `.setup()` and crashed at boot. auth now builds against Elysia 2.0.0-rc.0 and requires `^2.0.0-rc.0`: its hooks use the new names, and the session sweep starts and stops with the server (`onStart`/`onStop`).",
	kind: 'breaking',
	migration: {
		instruction:
			'Upgrade `elysia` and every `@elysia/*` package to 2.0.0-rc.0 (or later 2.x), then rename lifecycle hooks in your app: request → onRequest, beforeHandle → onBeforeHandle, afterHandle → onAfterHandle, afterResponse → onAfterResponse, error → onError, parse → onParse, transform → onTransform. `setup`/`cleanup` become `onStart`/`onStop`.',
		manual: true
	},
	summary:
		'Requires Elysia 2.0.0-rc.0: hooks use the `on` names, and the session sweep follows server start and stop',
	symbols: [
		'auth',
		'agentAuthContextPlugin',
		'agentAuthPlugin',
		'apiKeysRoutes',
		'complianceRoutes',
		'createAuthApplications',
		'createAuthContext',
		'createAuthHtmxRoutes',
		'createCredentialsApi',
		'createSignoutApi',
		'credentialRoutes',
		'credentialsEmailVerification',
		'credentialsLogin',
		'credentialsPasswordReset',
		'credentialsRegister',
		'identityRoutes',
		'mfaChallenge',
		'mfaManagementRoutes',
		'mfaRoutes',
		'mfaSmsRoutes',
		'mfaTotpRoutes',
		'nativePushRoutes',
		'oidcProviderRoutes',
		'oidcSsoRoutes',
		'organizationRoutes',
		'passwordlessRoutes',
		'portalRoutes',
		'protectPermissionPlugin',
		'protectRoutePlugin',
		'pushRoutes',
		'requireAuthPlugin',
		'roleRoutes',
		'samlIdpRoutes',
		'samlSsoRoutes',
		'scimRoutes',
		'sessionCleanup',
		'sessionRoutes',
		'sessionStore',
		'ssoDiscoveryRoute',
		'statusListRoutes',
		'stepUpPlugin',
		'vciRoutes',
		'vpRoutes',
		'webauthnRoutes'
	]
};
