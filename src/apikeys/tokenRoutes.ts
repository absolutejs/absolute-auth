import { DEFAULT_OIDC_ROUTE } from '../oidc/config';
import type { RouteString } from '../types';
import { DEFAULT_TOKEN_ROUTE, type ApiKeysConfig } from './config';

/** Elysia replaces duplicate method/path registrations. Refuse that setup
 * before composing the two independently configured token handlers. */
export const assertTokenRouteConfiguration = (
	apikeys: ApiKeysConfig | undefined,
	oidc: { oidcRoute?: RouteString } | undefined
) => {
	if (
		apikeys?.apiClientStore === undefined ||
		apikeys.accessTokenStore === undefined ||
		oidc === undefined
	)
		return;
	const apiTokenRoute = apikeys.tokenRoute ?? DEFAULT_TOKEN_ROUTE;
	const oidcTokenRoute = `${oidc.oidcRoute ?? DEFAULT_OIDC_ROUTE}/token`;
	if (apiTokenRoute.replace(/\/$/u, '') === oidcTokenRoute) {
		throw new Error(
			`Conflicting auth token routes: POST ${apiTokenRoute} is configured for both API client credentials and OIDC. Set apikeys.tokenRoute to a separate path (default: ${DEFAULT_TOKEN_ROUTE}).`
		);
	}
};
