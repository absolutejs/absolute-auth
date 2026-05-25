import { Elysia, t } from 'elysia';
import { MILLISECONDS_IN_A_MINUTE } from '../constants';
import { constantTimeEqual, generateSecureToken, hashToken } from '../crypto';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import type { AuthSessionStore } from '../session/types';
import type { RouteString } from '../types';
import { userSessionIdTypebox } from '../typebox';
import {
	DEFAULT_OIDC_ROUTE,
	exchangeToken,
	issueTokenSet,
	verifyPkce,
	type OidcProviderConfig
} from './config';
import { verifyDpopProof } from './dpop';
import { toPublicJwk } from './keys';
import type { OAuthClient } from './types';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FOUND = 302;
const CODE_TTL_MINUTES = 10;
const CODE_TTL_MS = MILLISECONDS_IN_A_MINUTE * CODE_TTL_MINUTES;
const TOKEN_BYTES = 32;
const BASIC_PREFIX = 'Basic ';

type TokenSet = Awaited<ReturnType<typeof issueTokenSet>>;

const jsonResponse = (value: unknown, status: number) =>
	new Response(JSON.stringify(value), {
		headers: {
			'cache-control': 'no-store',
			'content-type': 'application/json'
		},
		status
	});

const oauthError = (status: number, error: string) =>
	jsonResponse({ error }, status);

const tokenResponse = (tokens: TokenSet) => jsonResponse(tokens, HTTP_OK);

const redirectTo = (url: string) =>
	new Response(null, { headers: { location: url }, status: HTTP_FOUND });

// RFC 6749 §2.3.1 HTTP Basic client credentials.
const readBasicAuth = (authorization: string | undefined) => {
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

// The OAuth2 / OIDC provider routes. Mounted by `auth()` when `oidc` is configured.
export const oidcProviderRoutes = <UserType>(
	config: OidcProviderConfig<UserType> & {
		authSessionStore?: AuthSessionStore<UserType>;
	}
) => {
	const {
		authorizationCodeStore,
		authSessionStore,
		clientStore,
		getClaims,
		getGrantedScopes,
		getUserId,
		issuer,
		loginUrl,
		oidcRoute = DEFAULT_OIDC_ROUTE,
		refreshTokenStore,
		signingKey
	} = config;

	const authorizeRoute: RouteString = `${oidcRoute}/authorize`;
	const tokenRoute: RouteString = `${oidcRoute}/token`;
	const jwksRoute: RouteString = `${oidcRoute}/jwks`;
	const tokenUrl = `${issuer}${oidcRoute}/token`;

	const authenticateClient = async (
		clientId: string,
		clientSecret: string | undefined
	) => {
		const client = await clientStore.findClient(clientId);
		if (client === undefined) return undefined;
		if (client.hashedSecret === undefined) return client;
		if (clientSecret === undefined) return undefined;
		const matches = await constantTimeEqual(
			await hashToken(clientSecret),
			client.hashedSecret
		);

		return matches ? client : undefined;
	};

	const grantAuthorizationCode = async (
		client: OAuthClient,
		body: Record<string, string | undefined>,
		dpop: string | undefined
	) => {
		const {
			code,
			code_verifier: codeVerifier,
			redirect_uri: redirectUri
		} = body;
		if (
			code === undefined ||
			codeVerifier === undefined ||
			redirectUri === undefined
		) {
			return oauthError(HTTP_BAD_REQUEST, 'invalid_request');
		}
		const record = await authorizationCodeStore.consumeCode(
			await hashToken(code)
		);
		if (
			record === undefined ||
			record.expiresAt < Date.now() ||
			record.clientId !== client.clientId ||
			record.redirectUri !== redirectUri ||
			!(await verifyPkce(codeVerifier, record.codeChallenge))
		) {
			return oauthError(HTTP_BAD_REQUEST, 'invalid_grant');
		}
		const dpopResult =
			dpop === undefined
				? undefined
				: await verifyDpopProof({
						htm: 'POST',
						htu: tokenUrl,
						proof: dpop
					});
		if (dpop !== undefined && dpopResult === undefined) {
			return oauthError(HTTP_BAD_REQUEST, 'invalid_dpop_proof');
		}

		return tokenResponse(
			await issueTokenSet({
				claims: record.claims,
				clientId: client.clientId,
				config,
				dpopJkt: dpopResult?.jkt,
				nonce: record.nonce,
				scopes: record.scopes,
				sub: record.userId
			})
		);
	};

	const grantRefreshToken = async (
		client: OAuthClient,
		body: Record<string, string | undefined>,
		dpop: string | undefined
	) => {
		const presented = body.refresh_token;
		if (presented === undefined) {
			return oauthError(HTTP_BAD_REQUEST, 'invalid_request');
		}
		const record = await refreshTokenStore.consumeToken(
			await hashToken(presented)
		);
		if (
			record === undefined ||
			record.expiresAt < Date.now() ||
			record.clientId !== client.clientId
		) {
			return oauthError(HTTP_BAD_REQUEST, 'invalid_grant');
		}
		if (record.dpopJkt !== undefined) {
			const proof = await verifyDpopProof({
				htm: 'POST',
				htu: tokenUrl,
				proof: dpop
			});
			if (proof === undefined || proof.jkt !== record.dpopJkt) {
				return oauthError(HTTP_BAD_REQUEST, 'invalid_dpop_proof');
			}
		}

		return tokenResponse(
			await issueTokenSet({
				claims: record.claims,
				clientId: client.clientId,
				config,
				dpopJkt: record.dpopJkt,
				scopes: record.scopes,
				sub: record.userId
			})
		);
	};

	const grantTokenExchange = async (
		client: OAuthClient,
		body: Record<string, string | undefined>,
		dpop: string | undefined
	) => {
		if (body.subject_token === undefined) {
			return oauthError(HTTP_BAD_REQUEST, 'invalid_request');
		}
		const dpopResult =
			dpop === undefined
				? undefined
				: await verifyDpopProof({
						htm: 'POST',
						htu: tokenUrl,
						proof: dpop
					});
		if (dpop !== undefined && dpopResult === undefined) {
			return oauthError(HTTP_BAD_REQUEST, 'invalid_dpop_proof');
		}

		const result = await exchangeToken({
			actorClientId: client.clientId,
			audience: body.resource ?? body.audience,
			config,
			dpopJkt: dpopResult?.jkt,
			requestedScopes:
				body.scope === undefined || body.scope.length === 0
					? undefined
					: body.scope.split(' '),
			subjectToken: body.subject_token
		});
		if (!result.ok) return oauthError(HTTP_BAD_REQUEST, result.error);

		return jsonResponse(
			{
				access_token: result.accessToken,
				expires_in: result.expiresIn,
				issued_token_type:
					'urn:ietf:params:oauth:token-type:access_token',
				scope: result.scope,
				token_type: dpopResult === undefined ? 'Bearer' : 'DPoP'
			},
			HTTP_OK
		);
	};

	const discovery: Record<string, string | string[]> = {
		authorization_endpoint: `${issuer}${authorizeRoute}`,
		code_challenge_methods_supported: ['S256'],
		dpop_signing_alg_values_supported: ['ES256'],
		grant_types_supported: [
			'authorization_code',
			'refresh_token',
			'urn:ietf:params:oauth:grant-type:token-exchange'
		],
		id_token_signing_alg_values_supported: ['ES256'],
		issuer,
		jwks_uri: `${issuer}${jwksRoute}`,
		response_types_supported: ['code'],
		subject_types_supported: ['public'],
		token_endpoint: tokenUrl,
		token_endpoint_auth_methods_supported: [
			'client_secret_basic',
			'client_secret_post',
			'none'
		]
	};

	return new Elysia()
		.use(sessionStore<UserType>())
		.get(
			authorizeRoute,
			async ({ cookie: { user_session_id }, query, request, store }) => {
				const {
					client_id: clientId,
					code_challenge: codeChallenge,
					code_challenge_method: codeChallengeMethod,
					nonce,
					redirect_uri: redirectUri,
					response_type: responseType,
					scope,
					state
				} = query;

				const client =
					clientId === undefined
						? undefined
						: await clientStore.findClient(clientId);
				if (
					client === undefined ||
					redirectUri === undefined ||
					!client.redirectUris.includes(redirectUri)
				) {
					return jsonResponse(
						{ error: 'invalid_client' },
						HTTP_BAD_REQUEST
					);
				}

				const errorRedirect = (error: string) => {
					const params = new URLSearchParams({ error });
					if (state !== undefined) params.set('state', state);

					return redirectTo(`${redirectUri}?${params.toString()}`);
				};
				if (responseType !== 'code') {
					return errorRedirect('unsupported_response_type');
				}
				if (
					codeChallenge === undefined ||
					codeChallengeMethod !== 'S256'
				) {
					return errorRedirect('invalid_request');
				}

				const userSession = await loadSessionFromSource({
					authSessionStore,
					session: store.session,
					userSessionId: user_session_id.value
				});
				if (userSession === undefined) {
					return loginUrl === undefined
						? jsonResponse(
								{ error: 'login_required' },
								HTTP_UNAUTHORIZED
							)
						: redirectTo(
								`${loginUrl}?return_to=${encodeURIComponent(request.url)}`
							);
				}

				const requested =
					scope === undefined || scope.length === 0
						? client.scopes
						: scope
								.split(' ')
								.filter((entry) =>
									client.scopes.includes(entry)
								);
				const granted =
					getGrantedScopes === undefined
						? requested
						: await getGrantedScopes({
								client: {
									clientId: client.clientId,
									name: client.name
								},
								requestedScopes: requested,
								user: userSession.user
							});
				if (granted === undefined)
					return errorRedirect('access_denied');

				const code = generateSecureToken(TOKEN_BYTES);
				await authorizationCodeStore.saveCode({
					claims: getClaims?.(userSession.user),
					clientId: client.clientId,
					codeChallenge,
					codeHash: await hashToken(code),
					createdAt: Date.now(),
					expiresAt: Date.now() + CODE_TTL_MS,
					nonce,
					redirectUri,
					scopes: granted,
					userId: getUserId(userSession.user)
				});

				const params = new URLSearchParams({ code });
				if (state !== undefined) params.set('state', state);

				return redirectTo(`${redirectUri}?${params.toString()}`);
			},
			{
				cookie: t.Cookie({
					user_session_id: t.Optional(userSessionIdTypebox)
				}),
				query: t.Object({
					client_id: t.Optional(t.String()),
					code_challenge: t.Optional(t.String()),
					code_challenge_method: t.Optional(t.String()),
					nonce: t.Optional(t.String()),
					redirect_uri: t.Optional(t.String()),
					response_type: t.Optional(t.String()),
					scope: t.Optional(t.String()),
					state: t.Optional(t.String())
				})
			}
		)
		.post(
			tokenRoute,
			async ({ body, headers }) => {
				const basic = readBasicAuth(headers.authorization);
				const clientId = basic.clientId ?? body.client_id;
				const clientSecret = basic.clientSecret ?? body.client_secret;
				if (clientId === undefined) {
					return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
				}
				const client = await authenticateClient(clientId, clientSecret);
				if (client === undefined) {
					return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
				}

				if (body.grant_type === 'authorization_code') {
					return grantAuthorizationCode(client, body, headers.dpop);
				}
				if (body.grant_type === 'refresh_token') {
					return grantRefreshToken(client, body, headers.dpop);
				}
				if (
					body.grant_type ===
					'urn:ietf:params:oauth:grant-type:token-exchange'
				) {
					return grantTokenExchange(client, body, headers.dpop);
				}

				return oauthError(HTTP_BAD_REQUEST, 'unsupported_grant_type');
			},
			{
				body: t.Object({
					audience: t.Optional(t.String()),
					client_id: t.Optional(t.String()),
					client_secret: t.Optional(t.String()),
					code: t.Optional(t.String()),
					code_verifier: t.Optional(t.String()),
					grant_type: t.Optional(t.String()),
					redirect_uri: t.Optional(t.String()),
					refresh_token: t.Optional(t.String()),
					resource: t.Optional(t.String()),
					scope: t.Optional(t.String()),
					subject_token: t.Optional(t.String()),
					subject_token_type: t.Optional(t.String())
				})
			}
		)
		.get(jwksRoute, () => ({ keys: [toPublicJwk(signingKey)] }))
		.get('/.well-known/openid-configuration', () => discovery);
};
