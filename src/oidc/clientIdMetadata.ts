import type { OAuthClient } from './types';

export type ClientIdMetadataDocument = {
	client_id: string;
	client_name?: string;
	redirect_uris: string[];
	grant_types?: string[];
	response_types?: string[];
	token_endpoint_auth_method?:
		| 'none'
		| 'private_key_jwt'
		| 'self_signed_tls_client_auth';
	application_type?: 'native' | 'web';
	client_uri?: string;
	logo_uri?: string;
	policy_uri?: string;
	tos_uri?: string;
	jwks_uri?: string;
	jwks?: { keys: JsonWebKey[] };
	scope?: string;
};

const secureUrl = (value: string) => {
	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
};

export const clientIdMetadataToOAuthClient = (
	document: ClientIdMetadataDocument
): OAuthClient => ({
	clientId: document.client_id,
	grantTypes: document.grant_types ?? ['authorization_code', 'refresh_token'],
	...(document.jwks === undefined ? {} : { jwks: document.jwks.keys }),
	...(document.jwks_uri === undefined ? {} : { jwksUri: document.jwks_uri }),
	name: document.client_name ?? new URL(document.client_id).hostname,
	redirectUris: [...document.redirect_uris],
	scopes: document.scope?.split(' ').filter(Boolean) ?? []
});
export const createClientIdMetadataResolver = ({
	fetch: fetcher,
	allow = async () => true,
	cacheTtlMs = 5 * 60 * 1000,
	maxBytes = 5 * 1024,
	now = Date.now
}: {
	fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
	allow?: (clientId: string) => boolean | Promise<boolean>;
	cacheTtlMs?: number;
	maxBytes?: number;
	now?: () => number;
}) => {
	const cache = new Map<string, { client: OAuthClient; expiresAt: number }>();

	return async (clientId: string) => {
		if (!secureUrl(clientId) || !(await allow(clientId))) return undefined;
		const cached = cache.get(clientId);
		if (cached !== undefined && cached.expiresAt > now())
			return cached.client;
		const response = await fetcher(clientId, {
			headers: { accept: 'application/json' },
			redirect: 'error'
		});
		if (!response.ok) return undefined;
		const declaredLength = Number(
			response.headers.get('content-length') ?? '0'
		);
		if (declaredLength > maxBytes) return undefined;
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxBytes) return undefined;
		let document: ClientIdMetadataDocument;
		try {
			document = JSON.parse(new TextDecoder().decode(bytes));
		} catch {
			return undefined;
		}
		if (validateClientIdMetadataDocument(document, clientId).length > 0)
			return undefined;
		const client = clientIdMetadataToOAuthClient(document);
		cache.set(clientId, { client, expiresAt: now() + cacheTtlMs });

		return client;
	};
};

const validateRedirectUri = (uri: string) => {
	try {
		const parsed = new URL(uri);
		if (parsed.protocol === 'https:' || parsed.hostname === 'localhost')
			return undefined;

		return 'redirect URIs must use HTTPS or localhost';
	} catch {
		return 'redirect URI is invalid';
	}
};

const validateSecureMetadataUrl = (
	name: string,
	value: string | undefined
) => (value !== undefined && !secureUrl(value) ? `${name} must use HTTPS` : undefined);

export const validateClientIdMetadataDocument = (
	document: ClientIdMetadataDocument,
	expectedClientId: string
) => {
	const errors: string[] = [];
	if (document.client_id !== expectedClientId)
		errors.push('client_id does not match the metadata document URL');
	if (!secureUrl(document.client_id)) errors.push('client_id must use HTTPS');
	if (
		!Array.isArray(document.redirect_uris) ||
		document.redirect_uris.length === 0
	)
		errors.push('redirect_uris is required');
	for (const uri of document.redirect_uris ?? []) {
		const error = validateRedirectUri(uri);
		if (error !== undefined) errors.push(error);
	}
	for (const [name, value] of [
		['client_uri', document.client_uri],
		['logo_uri', document.logo_uri],
		['policy_uri', document.policy_uri],
		['tos_uri', document.tos_uri],
		['jwks_uri', document.jwks_uri]
	] as const) {
		const error = validateSecureMetadataUrl(name, value);
		if (error !== undefined) errors.push(error);
	}

	return errors;
};
