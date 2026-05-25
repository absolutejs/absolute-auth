import { Elysia, t } from 'elysia';
import {
	DEFAULT_TOKEN_ROUTE,
	exchangeClientCredentials,
	type ApiKeysConfig
} from './config';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;

const BASIC_PREFIX = 'Basic ';
const GRANT_CLIENT_CREDENTIALS = 'client_credentials';

type ClientCredentials = {
	clientId?: string;
	clientSecret?: string;
};

// RFC 6749 §2.3.1 lets a client present its credentials via HTTP Basic auth
// (base64 of `client_id:client_secret`) instead of the request body.
const readBasicAuth = (
	authorization: string | undefined
): ClientCredentials => {
	if (
		authorization === undefined ||
		!authorization.startsWith(BASIC_PREFIX)
	) {
		return {};
	}
	const decoded = Buffer.from(
		authorization.slice(BASIC_PREFIX.length),
		'base64'
	).toString('utf8');
	const separator = decoded.indexOf(':');
	if (separator < 0) return {};

	return {
		clientId: decoded.slice(0, separator),
		clientSecret: decoded.slice(separator + 1)
	};
};

const oauthError = (statusCode: number, error: string) =>
	new Response(JSON.stringify({ error }), {
		headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
		status: statusCode
	});

// The OAuth2 client_credentials token endpoint. Mounted only when both the
// client store and the access-token store are configured; static-key auth needs
// no routes (the consumer wires its own management + guard with the helpers).
export const apiKeysRoutes = ({
	accessTokenStore,
	accessTokenTtlMs,
	apiClientStore,
	tokenRoute = DEFAULT_TOKEN_ROUTE
}: ApiKeysConfig) => {
	if (apiClientStore === undefined || accessTokenStore === undefined) {
		return new Elysia();
	}

	return new Elysia().post(
		tokenRoute,
		async ({ body, headers }) => {
			if (body.grant_type !== GRANT_CLIENT_CREDENTIALS) {
				return oauthError(HTTP_BAD_REQUEST, 'unsupported_grant_type');
			}

			const basic = readBasicAuth(headers.authorization);
			const clientId = basic.clientId ?? body.client_id;
			const clientSecret = basic.clientSecret ?? body.client_secret;
			if (clientId === undefined || clientSecret === undefined) {
				return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
			}

			const result = await exchangeClientCredentials({
				accessTokenStore,
				apiClientStore,
				clientId,
				clientSecret,
				requestedScopes:
					body.scope === undefined || body.scope.length === 0
						? undefined
						: body.scope.split(' '),
				ttlMs: accessTokenTtlMs
			});

			if (!result.ok) {
				return oauthError(
					result.error === 'invalid_scope'
						? HTTP_BAD_REQUEST
						: HTTP_UNAUTHORIZED,
					result.error
				);
			}

			return new Response(
				JSON.stringify({
					access_token: result.accessToken,
					expires_in: result.expiresIn,
					scope: result.scopes.join(' '),
					token_type: 'Bearer'
				}),
				{
					headers: {
						'cache-control': 'no-store',
						'content-type': 'application/json'
					},
					status: HTTP_OK
				}
			);
		},
		{
			body: t.Object({
				client_id: t.Optional(t.String()),
				client_secret: t.Optional(t.String()),
				grant_type: t.Optional(t.String()),
				scope: t.Optional(t.String())
			})
		}
	);
};
