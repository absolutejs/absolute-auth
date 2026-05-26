import { Elysia, t } from 'elysia';
import { MILLISECONDS_IN_A_MINUTE } from '../constants';
import { constantTimeEqual, generateSecureToken, hashToken } from '../crypto';
import { loadSessionFromSource } from '../session/access';
import { clearSession } from '../session/promote';
import { sessionStore } from '../session/state';
import type { AuthSessionStore } from '../session/types';
import type { RouteString } from '../types';
import { userSessionIdTypebox } from '../typebox';
import {
	approveDeviceAuthorization,
	DEFAULT_OIDC_ROUTE,
	denyDeviceAuthorization,
	exchangeDeviceCode,
	exchangeToken,
	introspectToken,
	issueDeviceAuthorization,
	issueTokenSet,
	revokeRefreshToken,
	verifyPkce,
	type OidcProviderConfig
} from './config';
import {
	CLIENT_ASSERTION_TYPE,
	verifyClientAssertion
} from './clientAuth';
import { verifyDpopProof } from './dpop';
import { toPublicJwk } from './keys';
import {
	fanOutBackchannelLogout,
	resolvePostLogoutRedirect,
	verifyIdTokenHint
} from './logout';
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
	const introspectRoute: RouteString = `${oidcRoute}/introspect`;
	const revokeRoute: RouteString = `${oidcRoute}/revoke`;
	const deviceAuthorizationRoute: RouteString = `${oidcRoute}/device_authorization`;
	const deviceApproveRoute: RouteString = `${oidcRoute}/device/decision`;
	const endSessionRoute: RouteString = `${oidcRoute}/end_session`;
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

	// Token-endpoint client auth router. Tries `private_key_jwt` (RFC 7521/7523) first
	// when the client presented a `client_assertion`; falls back to the classic
	// `client_secret_basic` / `client_secret_post` path. Returns the verified client or
	// `undefined`; the caller turns that into `invalid_client` (401).
	const authenticateTokenClient = async ({
		basicClientId,
		basicClientSecret,
		bodyClientAssertion,
		bodyClientAssertionType,
		bodyClientId,
		bodyClientSecret
	}: {
		basicClientId: string | undefined;
		basicClientSecret: string | undefined;
		bodyClientAssertion: string | undefined;
		bodyClientAssertionType: string | undefined;
		bodyClientId: string | undefined;
		bodyClientSecret: string | undefined;
	}) => {
		if (
			bodyClientAssertion !== undefined &&
			bodyClientAssertionType === CLIENT_ASSERTION_TYPE
		) {
			return verifyClientAssertion({
				assertion: bodyClientAssertion,
				expectedAudience: tokenUrl,
				jtiStore: config.clientAssertionJtiStore,
				resolveClient: clientStore.findClient
			});
		}
		const clientId = bodyClientId ?? basicClientId;
		const clientSecret = bodyClientSecret ?? basicClientSecret;
		if (clientId === undefined) return undefined;

		return authenticateClient(clientId, clientSecret);
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

	const grantDeviceCode = async (
		client: OAuthClient,
		body: Record<string, string | undefined>,
		dpop: string | undefined
	) => {
		if (config.deviceAuthorizationStore === undefined) {
			return oauthError(HTTP_BAD_REQUEST, 'unsupported_grant_type');
		}
		if (body.device_code === undefined) {
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

		const result = await exchangeDeviceCode({
			clientId: client.clientId,
			config,
			deviceCode: body.device_code,
			dpopJkt: dpopResult?.jkt
		});
		if (!result.ok) return oauthError(HTTP_BAD_REQUEST, result.error);

		return jsonResponse(
			{
				access_token: result.access_token,
				expires_in: result.expires_in,
				id_token: result.id_token,
				refresh_token: result.refresh_token,
				scope: result.scope,
				token_type: dpopResult === undefined ? 'Bearer' : 'DPoP'
			},
			HTTP_OK
		);
	};

	const grantTypes = [
		'authorization_code',
		'refresh_token',
		'urn:ietf:params:oauth:grant-type:token-exchange'
	];
	if (config.deviceAuthorizationStore) {
		grantTypes.push('urn:ietf:params:oauth:grant-type:device_code');
	}

	const discovery: Record<string, boolean | string | string[]> = {
		authorization_endpoint: `${issuer}${authorizeRoute}`,
		backchannel_logout_session_supported: false,
		backchannel_logout_supported: true,
		code_challenge_methods_supported: ['S256'],
		dpop_signing_alg_values_supported: ['ES256'],
		end_session_endpoint: `${issuer}${endSessionRoute}`,
		grant_types_supported: grantTypes,
		id_token_signing_alg_values_supported: ['ES256'],
		introspection_endpoint: `${issuer}${introspectRoute}`,
		issuer,
		jwks_uri: `${issuer}${jwksRoute}`,
		response_types_supported: ['code'],
		revocation_endpoint: `${issuer}${revokeRoute}`,
		subject_types_supported: ['public'],
		token_endpoint: tokenUrl,
		token_endpoint_auth_methods_supported: [
			'client_secret_basic',
			'client_secret_post',
			'none',
			'private_key_jwt'
		],
		token_endpoint_auth_signing_alg_values_supported: ['ES256']
	};
	if (config.deviceAuthorizationStore) {
		discovery.device_authorization_endpoint = `${issuer}${deviceAuthorizationRoute}`;
	}

	const handleEndSession = async ({
		cookie,
		inMemorySession,
		query
	}: {
		cookie: Parameters<typeof clearSession<UserType>>[0]['cookie'];
		inMemorySession: Parameters<
			typeof clearSession<UserType>
		>[0]['inMemorySession'];
		query: {
			client_id?: string;
			id_token_hint?: string;
			post_logout_redirect_uri?: string;
			state?: string;
		};
	}) => {
		// Resolve the initiating RP from id_token_hint (preferred) or client_id. The
		// hint also gives us the user `sub` we need for back-channel fan-out.
		const hint =
			query.id_token_hint === undefined
				? undefined
				: await verifyIdTokenHint({
						config,
						idTokenHint: query.id_token_hint
					});
		const clientId = hint?.audClientId ?? query.client_id;
		const client =
			clientId === undefined
				? undefined
				: await config.clientStore.findClient(clientId);
		// Best-effort: pull the logged-in user's sub from the session as a fallback
		// when no id_token_hint was supplied, so we can still fan out back-channel
		// pushes for the active session.
		const userSession = await loadSessionFromSource({
			authSessionStore,
			session: inMemorySession,
			userSessionId: cookie.value
		});
		const resolvedSub =
			hint?.sub ??
			(userSession === undefined
				? undefined
				: getUserId(userSession.user));

		await clearSession({
			authSessionStore,
			cookie,
			inMemorySession
		});

		if (resolvedSub !== undefined) {
			await fanOutBackchannelLogout({
				config,
				skipClientId: clientId,
				userId: resolvedSub
			});
		}

		const redirectUri =
			client === undefined
				? undefined
				: resolvePostLogoutRedirect({
						client,
						requestedUri: query.post_logout_redirect_uri
					});
		if (redirectUri === undefined) {
			return jsonResponse({ ok: true }, HTTP_OK);
		}

		const url = new URL(redirectUri);
		if (query.state !== undefined) url.searchParams.set('state', query.state);

		return redirectTo(url.toString());
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
				const client = await authenticateTokenClient({
					basicClientId: basic.clientId,
					basicClientSecret: basic.clientSecret,
					bodyClientAssertion: body.client_assertion,
					bodyClientAssertionType: body.client_assertion_type,
					bodyClientId: body.client_id,
					bodyClientSecret: body.client_secret
				});
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
				if (
					body.grant_type ===
					'urn:ietf:params:oauth:grant-type:device_code'
				) {
					return grantDeviceCode(client, body, headers.dpop);
				}

				return oauthError(HTTP_BAD_REQUEST, 'unsupported_grant_type');
			},
			{
				body: t.Object({
					audience: t.Optional(t.String()),
					client_assertion: t.Optional(t.String()),
					client_assertion_type: t.Optional(t.String()),
					client_id: t.Optional(t.String()),
					client_secret: t.Optional(t.String()),
					code: t.Optional(t.String()),
					code_verifier: t.Optional(t.String()),
					device_code: t.Optional(t.String()),
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
		// RFC 7662 — token introspection. Authenticated clients learn whether
		// a token is active. Tokens we issued ourselves are checked: JWT
		// access tokens are verified against our signing key + exp; refresh
		// tokens are looked up by hash. Unknown / expired / wrong-issuer
		// tokens come back as `{ active: false }` — never an error.
		.post(
			introspectRoute,
			async ({ body, headers }) => {
				const basic = readBasicAuth(headers.authorization);
				const clientId = body.client_id ?? basic.clientId;
				const clientSecret = body.client_secret ?? basic.clientSecret;
				if (clientId === undefined) {
					return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
				}
				const client = await authenticateClient(clientId, clientSecret);
				if (client === undefined) {
					return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
				}
				const result = await introspectToken({
					config,
					hint:
						body.token_type_hint === 'access_token' ||
						body.token_type_hint === 'refresh_token'
							? body.token_type_hint
							: undefined,
					now: Date.now(),
					token: body.token
				});

				return jsonResponse(result, HTTP_OK);
			},
			{
				body: t.Object({
					client_id: t.Optional(t.String()),
					client_secret: t.Optional(t.String()),
					token: t.String(),
					token_type_hint: t.Optional(t.String())
				}),
				headers: t.Object({
					authorization: t.Optional(t.String())
				})
			}
		)
		// RFC 7009 — token revocation. Refresh tokens are deleted from the
		// store. Access tokens (JWT) are stateless, so the response is 200
		// OK without action — spec-permitted ("the authorization server
		// responds with HTTP status code 200 if the token has been revoked
		// successfully or if the client submitted an invalid token").
		.post(
			revokeRoute,
			async ({ body, headers }) => {
				const basic = readBasicAuth(headers.authorization);
				const clientId = body.client_id ?? basic.clientId;
				const clientSecret = body.client_secret ?? basic.clientSecret;
				if (clientId === undefined) {
					return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
				}
				const client = await authenticateClient(clientId, clientSecret);
				if (client === undefined) {
					return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
				}
				if (body.token_type_hint !== 'access_token') {
					await revokeRefreshToken(config, body.token);
				}

				return new Response(null, { status: HTTP_OK });
			},
			{
				body: t.Object({
					client_id: t.Optional(t.String()),
					client_secret: t.Optional(t.String()),
					token: t.String(),
					token_type_hint: t.Optional(t.String())
				}),
				headers: t.Object({
					authorization: t.Optional(t.String())
				})
			}
		)
		// RFC 8628 §3.1 — device authorization request. Clients (CLIs,
		// smart TVs, IoT) ask for a device_code + user_code pair, then poll
		// /token while the user approves on a second device.
		.post(
			deviceAuthorizationRoute,
			async ({ body, headers }) => {
				if (config.deviceAuthorizationStore === undefined) {
					return oauthError(HTTP_BAD_REQUEST, 'unsupported_grant_type');
				}
				const basic = readBasicAuth(headers.authorization);
				const clientId = body.client_id ?? basic.clientId;
				const clientSecret = body.client_secret ?? basic.clientSecret;
				if (clientId === undefined) {
					return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
				}
				const client = await authenticateClient(clientId, clientSecret);
				if (client === undefined) {
					return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
				}
				const requested =
					body.scope === undefined || body.scope.length === 0
						? client.scopes
						: body.scope
								.split(' ')
								.filter((entry) => client.scopes.includes(entry));
				const response = await issueDeviceAuthorization({
					clientId: client.clientId,
					config,
					now: Date.now(),
					requestedScopes: requested
				});

				return jsonResponse(response, HTTP_OK);
			},
			{
				body: t.Object({
					client_id: t.Optional(t.String()),
					client_secret: t.Optional(t.String()),
					scope: t.Optional(t.String())
				}),
				headers: t.Object({
					authorization: t.Optional(t.String())
				})
			}
		)
		// Internal verification endpoint — the consumer-built device-flow
		// UI POSTs here once the user types their user_code and confirms
		// (or denies). Requires an authenticated user session. Returns
		// 200 + { ok: true } or an oauthError describing what went wrong.
		.post(
			deviceApproveRoute,
			async ({ body, cookie: { user_session_id }, store }) => {
				if (config.deviceAuthorizationStore === undefined) {
					return oauthError(HTTP_BAD_REQUEST, 'unsupported_grant_type');
				}
				const userSession = await loadSessionFromSource({
					authSessionStore,
					session: store.session,
					userSessionId: user_session_id.value
				});
				if (userSession === undefined) {
					return oauthError(HTTP_UNAUTHORIZED, 'login_required');
				}
				const result =
					body.action === 'deny'
						? await denyDeviceAuthorization({
								config,
								userCode: body.user_code
							})
						: await approveDeviceAuthorization({
								config,
								userCode: body.user_code,
								userSub: getUserId(userSession.user)
							});
				if (!result.ok) return oauthError(HTTP_BAD_REQUEST, result.error);

				return jsonResponse({ ok: true }, HTTP_OK);
			},
			{
				body: t.Object({
					action: t.Optional(
						t.Union([t.Literal('approve'), t.Literal('deny')])
					),
					user_code: t.String()
				}),
				cookie: t.Cookie({
					user_session_id: t.Optional(userSessionIdTypebox)
				})
			}
		)
		// OIDC RP-initiated logout (Session Management 1.0). The RP redirects the user
		// here with `id_token_hint` (which we verify was signed by us) + an optional
		// `post_logout_redirect_uri` (must be in the client's allow-list). We clear the
		// user's session + fan out back-channel `logout_token` POSTs to every OTHER RP
		// with active refresh tokens for this user + a registered backchannel URI. Spec
		// allows GET + POST; we support both.
		.get(
			endSessionRoute,
			async ({
				cookie: { user_session_id },
				query,
				store
			}) =>
				handleEndSession({
					cookie: user_session_id,
					inMemorySession: store.session,
					query
				}),
			{
				cookie: t.Cookie({
					user_session_id: t.Optional(userSessionIdTypebox)
				}),
				query: t.Object({
					client_id: t.Optional(t.String()),
					id_token_hint: t.Optional(t.String()),
					post_logout_redirect_uri: t.Optional(t.String()),
					state: t.Optional(t.String())
				})
			}
		)
		.post(
			endSessionRoute,
			async ({
				body,
				cookie: { user_session_id },
				store
			}) =>
				handleEndSession({
					cookie: user_session_id,
					inMemorySession: store.session,
					query: body
				}),
			{
				body: t.Object({
					client_id: t.Optional(t.String()),
					id_token_hint: t.Optional(t.String()),
					post_logout_redirect_uri: t.Optional(t.String()),
					state: t.Optional(t.String())
				}),
				cookie: t.Cookie({
					user_session_id: t.Optional(userSessionIdTypebox)
				})
			}
		)
		.get(jwksRoute, () => ({ keys: [toPublicJwk(signingKey)] }))
		.get('/.well-known/openid-configuration', () => discovery);
};
