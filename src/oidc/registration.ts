// RFC 7591 (Dynamic Client Registration) + RFC 7592 (Management Protocol).
//
// Clients can self-register at `POST /oauth2/register`, receiving a `client_id` + a
// rotatable `registration_access_token` that authorizes subsequent management calls
// (`GET/PUT/DELETE /oauth2/register/{client_id}`). Closed federations gate registration
// behind an `initial_access_token` the operator pre-issues; open registration omits the
// gate. Either way, the consumer can stamp `onClientRegistration` to deny / transform
// requested metadata before it lands in the client store.

import { generateSecureToken, hashToken } from '../crypto';
import type {
	ClientRegistrationTokenStore,
	InitialAccessTokenStore,
	OAuthClient,
	OAuthClientStore
} from './types';

const REG_TOKEN_BYTES = 32;
const CLIENT_ID_BYTES = 16;

export type ClientRegistrationMetadata = {
	backchannel_logout_uri?: string;
	client_name?: string;
	grant_types?: string[];
	jwks?: JsonWebKey[];
	jwks_uri?: string;
	post_logout_redirect_uris?: string[];
	// Optional at the type level so callers can pass route-body shapes directly; the
	// register/update flows validate "non-empty array" at runtime + return 400.
	redirect_uris?: string[];
	scope?: string;
};

export type ClientRegistrationDecision =
	| { allow: false; denyReason: string }
	| { allow: true; transform?: Partial<OAuthClient> };

export type OnClientRegistration = (context: {
	metadata: ClientRegistrationMetadata;
}) => ClientRegistrationDecision | Promise<ClientRegistrationDecision>;

export type OnClientRegistered = (context: {
	client: OAuthClient;
	metadata: ClientRegistrationMetadata;
}) => void | Promise<void>;

// Build a freshly-generated reg-access-token pair (plain to return to the client, hash to
// persist) so subsequent management calls can be authenticated without storing the
// plaintext token.
const mintRegistrationToken = async (clientId: string) => {
	const plain = generateSecureToken(REG_TOKEN_BYTES);

	return {
		plain,
		record: {
			clientId,
			createdAt: Date.now(),
			tokenHash: await hashToken(plain)
		}
	};
};

const metadataToClient = (
	clientId: string,
	metadata: ClientRegistrationMetadata,
	transform?: Partial<OAuthClient>
): OAuthClient => {
	const requestedScopes =
		metadata.scope === undefined || metadata.scope.length === 0
			? []
			: metadata.scope.split(' ').filter((entry) => entry.length > 0);
	const base: OAuthClient = {
		backchannelLogoutUri: metadata.backchannel_logout_uri,
		clientId,
		grantTypes: metadata.grant_types,
		jwks: metadata.jwks,
		jwksUri: metadata.jwks_uri,
		name: metadata.client_name ?? clientId,
		postLogoutRedirectUris: metadata.post_logout_redirect_uris,
		redirectUris: metadata.redirect_uris ?? [],
		scopes: requestedScopes
	};

	return { ...base, ...transform, clientId };
};

const clientToMetadata = (
	client: OAuthClient
): ClientRegistrationMetadata & { client_id: string } => ({
	backchannel_logout_uri: client.backchannelLogoutUri,
	client_id: client.clientId,
	client_name: client.name,
	grant_types: client.grantTypes,
	jwks: client.jwks,
	jwks_uri: client.jwksUri,
	post_logout_redirect_uris: client.postLogoutRedirectUris,
	redirect_uris: client.redirectUris,
	scope: client.scopes.join(' ')
});

export type RegisterClientResult =
	| {
			body: { error: string; error_description?: string };
			ok: false;
			status: 400 | 401 | 403 | 501;
	  }
	| {
			body: ClientRegistrationMetadata & {
				client_id: string;
				registration_access_token: string;
				registration_client_uri: string;
			};
			ok: true;
	  };

const readRegistrationAccessToken = (authorization: string | undefined) => {
	const prefix = 'Bearer ';
	if (authorization === undefined || !authorization.startsWith(prefix)) {
		return undefined;
	}

	return authorization.slice(prefix.length).trim();
};

const authorizeManagement = async ({
	authorization,
	clientId,
	registrationTokenStore
}: {
	authorization: string | undefined;
	clientId: string;
	registrationTokenStore: ClientRegistrationTokenStore;
}) => {
	const presented = readRegistrationAccessToken(authorization);
	if (presented === undefined) return false;
	const record = await registrationTokenStore.findByTokenHash(
		await hashToken(presented)
	);

	return record?.clientId === clientId;
};

// Handle DELETE /oauth2/register/{client_id} — drop the client + invalidate its reg token.
export const deleteRegisteredClient = async ({
	authorization,
	clientId,
	clientStore,
	registrationTokenStore
}: {
	authorization: string | undefined;
	clientId: string;
	clientStore: OAuthClientStore;
	registrationTokenStore: ClientRegistrationTokenStore;
}) => {
	if (clientStore.deleteClient === undefined) {
		return {
			body: { error: 'unsupported_response_type' },
			status: 501
		} as const;
	}
	const authed = await authorizeManagement({
		authorization,
		clientId,
		registrationTokenStore
	});
	if (!authed)
		return { body: { error: 'invalid_token' }, status: 401 } as const;
	await clientStore.deleteClient(clientId);
	await registrationTokenStore.deleteByClientId(clientId);

	return { status: 204 } as const;
};

// Handle GET /oauth2/register/{client_id} — read current metadata.
export const getRegisteredClient = async ({
	authorization,
	clientId,
	clientStore,
	registrationTokenStore
}: {
	authorization: string | undefined;
	clientId: string;
	clientStore: OAuthClientStore;
	registrationTokenStore: ClientRegistrationTokenStore;
}) => {
	const authed = await authorizeManagement({
		authorization,
		clientId,
		registrationTokenStore
	});
	if (!authed)
		return { body: { error: 'invalid_token' }, status: 401 } as const;
	const client = await clientStore.findClient(clientId);
	if (client === undefined) {
		return { body: { error: 'invalid_client' }, status: 404 } as const;
	}

	return { body: clientToMetadata(client), status: 200 } as const;
};

// Handle POST /oauth2/register. The consumer drives the actual HTTP response off the
// returned `{ok, status, body}` envelope. We return 501 when the necessary stores aren't
// configured, 403 when an initial-access-token gate is active and the caller didn't
// present a valid one, 400 when policy denies, and 200 OK with the freshly-minted client.
export const registerClient = async ({
	clientStore,
	initialAccessTokenStore,
	metadata,
	onClientRegistration,
	onClientRegistered,
	presentedInitialAccessToken,
	registrationBaseUrl,
	registrationTokenStore
}: {
	clientStore: OAuthClientStore;
	initialAccessTokenStore?: InitialAccessTokenStore;
	metadata: ClientRegistrationMetadata;
	onClientRegistration?: OnClientRegistration;
	onClientRegistered?: OnClientRegistered;
	presentedInitialAccessToken?: string;
	// Absolute URL prefix for the per-client management URI, e.g. `https://idp.example/oauth2/register`.
	registrationBaseUrl: string;
	registrationTokenStore: ClientRegistrationTokenStore;
}): Promise<RegisterClientResult> => {
	if (
		clientStore.saveClient === undefined ||
		clientStore.findClient === undefined
	) {
		return {
			body: { error: 'unsupported_response_type' },
			ok: false,
			status: 501
		};
	}
	if (initialAccessTokenStore !== undefined) {
		if (presentedInitialAccessToken === undefined) {
			return { body: { error: 'invalid_token' }, ok: false, status: 401 };
		}
		const consumed = await initialAccessTokenStore.consumeToken(
			await hashToken(presentedInitialAccessToken)
		);
		if (!consumed) {
			return { body: { error: 'invalid_token' }, ok: false, status: 401 };
		}
	}
	const requiresRedirect =
		metadata.grant_types === undefined ||
		metadata.grant_types.includes('authorization_code');
	if (
		requiresRedirect &&
		(!Array.isArray(metadata.redirect_uris) ||
			metadata.redirect_uris.length === 0)
	) {
		return {
			body: { error: 'invalid_redirect_uri' },
			ok: false,
			status: 400
		};
	}

	const decision: ClientRegistrationDecision = (await onClientRegistration?.({
		metadata
	})) ?? { allow: true };
	if (!decision.allow) {
		return {
			body: {
				error: 'invalid_client_metadata',
				error_description: decision.denyReason
			},
			ok: false,
			status: 403
		};
	}

	const clientId = generateSecureToken(CLIENT_ID_BYTES);
	const client = metadataToClient(clientId, metadata, decision.transform);
	await clientStore.saveClient(client);

	const regToken = await mintRegistrationToken(clientId);
	await registrationTokenStore.saveToken(regToken.record);
	await onClientRegistered?.({ client, metadata });

	return {
		body: {
			...clientToMetadata(client),
			registration_access_token: regToken.plain,
			registration_client_uri: `${registrationBaseUrl}/${clientId}`
		},
		ok: true
	};
};

// Handle PUT /oauth2/register/{client_id} — update metadata + rotate the reg-access-token.
// We mint a new token on every successful PUT so a leaked token's window is bounded by
// "until the next update". Clients store the rotated value.
export const updateRegisteredClient = async ({
	authorization,
	clientId,
	clientStore,
	metadata,
	onClientRegistration,
	registrationTokenStore
}: {
	authorization: string | undefined;
	clientId: string;
	clientStore: OAuthClientStore;
	metadata: ClientRegistrationMetadata;
	onClientRegistration?: OnClientRegistration;
	registrationTokenStore: ClientRegistrationTokenStore;
}) => {
	if (clientStore.updateClient === undefined) {
		return {
			body: { error: 'unsupported_response_type' },
			status: 501
		} as const;
	}
	const authed = await authorizeManagement({
		authorization,
		clientId,
		registrationTokenStore
	});
	if (!authed)
		return { body: { error: 'invalid_token' }, status: 401 } as const;
	const decision: ClientRegistrationDecision = (await onClientRegistration?.({
		metadata
	})) ?? { allow: true };
	if (!decision.allow) {
		return {
			body: {
				error: 'invalid_client_metadata',
				error_description: decision.denyReason
			},
			status: 403
		} as const;
	}
	const requiresRedirect =
		metadata.grant_types === undefined ||
		metadata.grant_types.includes('authorization_code');
	if (
		requiresRedirect &&
		(!Array.isArray(metadata.redirect_uris) ||
			metadata.redirect_uris.length === 0)
	) {
		return {
			body: { error: 'invalid_redirect_uri' },
			status: 400
		} as const;
	}

	const updated = metadataToClient(clientId, metadata, decision.transform);
	await clientStore.updateClient(clientId, updated);
	const rotated = await mintRegistrationToken(clientId);
	await registrationTokenStore.saveToken(rotated.record);

	return {
		body: {
			...clientToMetadata(updated),
			registration_access_token: rotated.plain
		},
		status: 200
	} as const;
};
