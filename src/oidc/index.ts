/**
 * Declaration-stable OIDC provider entry point.
 *
 * Server applications that only need to issue and verify OAuth/OIDC tokens
 * should import this subpath instead of loading every optional Auth feature
 * through the package root.
 */
export type { OidcProviderConfig } from './config';
export {
	generateSigningKey,
	jwkThumbprint,
	signJwt,
	toPublicJwk,
	verifyJwt,
	type SigningKey
} from './keys';
export { revokeOAuthClientCredentials } from './operator';
export {
	createNeonAuthorizationCodeStore,
	createNeonClientAssertionJtiStore,
	createNeonClientRegistrationTokenStore,
	createNeonDeviceAuthorizationStore,
	createNeonInitialAccessTokenStore,
	createNeonOAuthClientStore,
	createNeonOidcRefreshTokenStore,
	createPostgresAuthorizationCodeStore,
	createPostgresClientAssertionJtiStore,
	createPostgresClientRegistrationTokenStore,
	createPostgresDeviceAuthorizationStore,
	createPostgresInitialAccessTokenStore,
	createPostgresOAuthClientStore,
	createPostgresOidcRefreshTokenStore
} from './postgresStores';
export type {
	AuthorizationCodeStore,
	ClientAssertionJtiStore,
	ClientRegistrationTokenStore,
	DeviceAuthorizationStore,
	InitialAccessTokenStore,
	OAuthClient,
	OAuthClientStore,
	OidcRefreshTokenConnection,
	OidcRefreshTokenStore
} from './types';
