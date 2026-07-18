import type {
	AuthorizationCodeStore,
	ClientRegistrationTokenStore,
	DeviceAuthorizationStore,
	OidcRefreshTokenStore
} from './types';

type ClientCredentialRevocationStore = {
	deleteForClient?: (clientId: string) => Promise<number>;
};

type OAuthClientCredentialStores = {
	authorizationCodeStore: AuthorizationCodeStore;
	clientRegistrationTokenStore: ClientRegistrationTokenStore;
	deviceAuthorizationStore: DeviceAuthorizationStore;
	refreshTokenStore: OidcRefreshTokenStore;
};

const operatorDelete = (
	store: ClientCredentialRevocationStore,
	storeName: string
) => {
	if (!store.deleteForClient)
		throw new Error(`${storeName} does not support operator revocation`);

	return store.deleteForClient;
};

export const revokeOAuthClientCredentials = async (
	clientId: string,
	stores: OAuthClientCredentialStores
) => {
	const revokedAuthorizationCodes = await operatorDelete(
		stores.authorizationCodeStore,
		'Authorization code store'
	)(clientId);
	const revokedDeviceAuthorizations = await operatorDelete(
		stores.deviceAuthorizationStore,
		'Device authorization store'
	)(clientId);
	const revokedRefreshTokens = await operatorDelete(
		stores.refreshTokenStore,
		'Refresh token store'
	)(clientId);
	const revokedRegistrationTokens = await operatorDelete(
		stores.clientRegistrationTokenStore,
		'Client registration token store'
	)(clientId);

	return {
		revokedAuthorizationCodes,
		revokedDeviceAuthorizations,
		revokedRefreshTokens,
		revokedRegistrationTokens
	};
};
