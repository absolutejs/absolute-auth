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
	CIBA_GRANT_TYPE,
	DEFAULT_OIDC_ROUTE,
	denyDeviceAuthorization,
	exchangeBackchannelAuth,
	exchangeDeviceCode,
	exchangeToken,
	introspectToken,
	issueBackchannelAuth,
	issueDeviceAuthorization,
	issueTokenSet,
	revokeRefreshToken,
	verifyPkce,
	type OidcProviderConfig
} from './config';
import { CLIENT_ASSERTION_TYPE, verifyClientAssertion } from './clientAuth';
import { exchangePreAuthorizedCode, PRE_AUTHORIZED_CODE_GRANT } from './vci';
import { computeCertThumbprint, resolveClientCert } from './mtls';
import {
	extractDpopNonceClaim,
	mintDpopNonce,
	verifyDpopNonce,
	verifyDpopProof
} from './dpop';
import { toPublicJwk } from './keys';
import {
	fanOutBackchannelLogout,
	resolvePostLogoutRedirect,
	verifyIdTokenHint
} from './logout';
import { parseSignedRequestObject } from './jar';
import {
	consumePushedRequest,
	pushAuthorizationRequest,
	REQUEST_URI_PREFIX
} from './par';
import {
	fetchUserInfo,
	readUserInfoBearer,
	userInfoChallengeHeader
} from './userinfo';
import {
	deleteRegisteredClient,
	getRegisteredClient,
	registerClient,
	updateRegisteredClient
} from './registration';
import type { OAuthClient } from './types';

const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;
const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_IMPLEMENTED = 501;
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

// Behind a TLS-terminating proxy (nginx/Caddy/ALB) the runtime sees the
// request as http://, so raw request.url must never be used to build
// return_to links — rebase its origin onto the configured issuer.
const canonicalizeRequestUrl = (requestUrl: string, issuer: string) => {
	try {
		const url = new URL(requestUrl);
		const base = new URL(issuer);
		url.protocol = base.protocol;
		url.host = base.host;

		return url.toString();
	} catch {
		return requestUrl;
	}
};

const redirectTo = (url: string) =>
	new Response(null, { headers: { location: url }, status: HTTP_FOUND });

// HTML-escape the four characters that change meaning inside an HTML attribute
// value. The form_post response_mode renders untrusted parameter values
// (state, code, error, error_description) into <input value="..."> attrs.
const escapeHtmlAttr = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

// OAuth 2.0 Form Post Response Mode (openid.net/specs/oauth-v2-form-post-response-mode-1_0.html).
// Renders an auto-submitting HTML form POSTing the response parameters to the
// client's redirect_uri, instead of the default `?param=…` GET redirect. Used
// by clients that pass `response_mode=form_post` to /authorize — the typical
// motivation is keeping large response payloads out of the URL or browser
// history when the client can't accept fragment/query delivery.
const formPostResponse = (
	redirectUri: string,
	params: Record<string, string>
) => {
	const inputs = Object.entries(params)
		.map(
			([name, value]) =>
				`<input type="hidden" name="${escapeHtmlAttr(name)}" value="${escapeHtmlAttr(value)}" />`
		)
		.join('');
	const body =
		`<!DOCTYPE html><html><head><meta charset="utf-8" />` +
		`<title>Submitting…</title></head>` +
		`<body onload="document.forms[0].submit()">` +
		`<form method="post" action="${escapeHtmlAttr(redirectUri)}">${inputs}` +
		`<noscript><button type="submit">Continue</button></noscript>` +
		`</form></body></html>`;

	return new Response(body, {
		headers: {
			'cache-control': 'no-store',
			'content-type': 'text/html;charset=UTF-8'
		},
		status: HTTP_OK
	});
};

// Dispatch an /authorize response to the client according to its
// `response_mode`. Only the success / error pair: both routes use this so
// `?error=…` and `?code=…` go via the same channel (the spec requires it —
// you can't return a code via form_post and the error via query).
const respondToClient = (
	redirectUri: string,
	responseMode: string,
	params: Record<string, string>
) => {
	if (responseMode === 'form_post') {
		return formPostResponse(redirectUri, params);
	}
	const search = new URLSearchParams(params);

	return redirectTo(`${redirectUri}?${search.toString()}`);
};

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
	const backchannelAuthorizationRoute: RouteString = `${oidcRoute}/bc-authorize`;
	const deviceApproveRoute: RouteString = `${oidcRoute}/device/decision`;
	const endSessionRoute: RouteString = `${oidcRoute}/end_session`;
	const parRoute: RouteString = `${oidcRoute}/par`;
	const registrationRoute: RouteString = `${oidcRoute}/register`;
	const userinfoRoute: RouteString = `${oidcRoute}/userinfo`;
	const registrationBaseUrl = `${issuer}${registrationRoute}`;
	const tokenUrl = `${issuer}${oidcRoute}/token`;
	const resolveClient = async (clientId: string) =>
		(await clientStore.findClient(clientId)) ??
		(await config.resolveClientIdMetadata?.(clientId));

	const authenticateClient = async (
		clientId: string,
		clientSecret: string | undefined
	) => {
		const client = await resolveClient(clientId);
		if (client === undefined) return undefined;
		if (client.hashedSecret === undefined) return client;
		if (clientSecret === undefined) return undefined;
		const matches = await constantTimeEqual(
			await hashToken(clientSecret),
			client.hashedSecret
		);

		return matches ? client : undefined;
	};

	// RFC 8705 self_signed_tls_client_auth — match the inbound TLS cert's thumbprint
	// against the client's registered list. Returns the matched binding on hit; undefined
	// when this auth path isn't applicable (no registered thumbprints, no forwarded cert,
	// or thumbprint mismatch) so the caller falls through to the next auth method.
	const tryMtlsAuth = async ({
		candidate,
		extract,
		requestHeaders
	}: {
		candidate: OAuthClient | undefined;
		extract: OidcProviderConfig<UserType>['extractTlsClientCert'];
		requestHeaders: Headers;
	}) => {
		const registered = candidate?.tlsCertificateBoundThumbprints ?? [];
		if (candidate === undefined || registered.length === 0)
			return undefined;
		const cert = await resolveClientCert({
			extract,
			headers: requestHeaders
		});
		if (cert === undefined) return undefined;
		const presented = await computeCertThumbprint(cert);
		if (!registered.includes(presented)) return undefined;

		return { client: candidate, clientCertThumbprint: presented };
	};

	// Token-endpoint client auth router. Tries `private_key_jwt` (RFC 7521/7523) first
	// when the client presented a `client_assertion`; falls back to mTLS (RFC 8705
	// self_signed_tls_client_auth) when a forwarded client cert + a client with registered
	// thumbprints is present; then the classic `client_secret_basic` / `client_secret_post`
	// path. Returns the verified client + (optional) cert thumbprint to attach to the
	// access token's `cnf.x5t#S256` binding. The caller turns `undefined` into 401.
	const authenticateTokenClient = async ({
		basicClientId,
		basicClientSecret,
		bodyClientAssertion,
		bodyClientAssertionType,
		bodyClientId,
		bodyClientSecret,
		requestHeaders
	}: {
		basicClientId: string | undefined;
		basicClientSecret: string | undefined;
		bodyClientAssertion: string | undefined;
		bodyClientAssertionType: string | undefined;
		bodyClientId: string | undefined;
		bodyClientSecret: string | undefined;
		requestHeaders: Headers;
	}) => {
		if (
			bodyClientAssertion !== undefined &&
			bodyClientAssertionType === CLIENT_ASSERTION_TYPE
		) {
			const client = await verifyClientAssertion({
				assertion: bodyClientAssertion,
				expectedAudience: tokenUrl,
				jtiStore: config.clientAssertionJtiStore,
				resolveClient
			});

			return client === undefined
				? undefined
				: { client, clientCertThumbprint: undefined };
		}
		const clientId = bodyClientId ?? basicClientId;
		if (clientId === undefined) return undefined;

		const candidate = await resolveClient(clientId);
		// RFC 8705 self_signed_tls_client_auth: client registered cert thumbprints AND a
		// cert is forwarded by the reverse proxy. Match its SHA-256 thumbprint against the
		// registered list; on hit, return the client + the thumbprint for cnf binding.
		const mtlsResult = await tryMtlsAuth({
			candidate,
			extract: config.extractTlsClientCert,
			requestHeaders
		});
		if (mtlsResult !== undefined) return mtlsResult;

		const clientSecret = bodyClientSecret ?? basicClientSecret;
		// FAPI 2.0 baseline (RFC 9700) bans both `client_secret_basic` and
		// `client_secret_post` — only `private_key_jwt` + `tls_client_auth`
		// are conformant. When `strictFapi` is on, refuse to fall through.
		if (config.strictFapi === true && clientSecret !== undefined) {
			return undefined;
		}
		const client = await authenticateClient(clientId, clientSecret);

		return client === undefined
			? undefined
			: { client, clientCertThumbprint: undefined };
	};

	// RFC 9449 §8 — DPoP nonce challenge. Returns either:
	//   - `undefined` (no challenge needed; the proof either lacked DPoP entirely OR
	//     carried a valid nonce OR nonces aren't configured) → caller proceeds.
	//   - a 401 Response with a fresh `DPoP-Nonce` header + WWW-Authenticate hint →
	//     caller returns it verbatim; the RP retries with the issued nonce.
	const dpopNonceChallenge = async (proof: string | undefined) => {
		if (proof === undefined || config.dpopNonce === undefined) {
			return undefined;
		}
		const presented = extractDpopNonceClaim(proof);
		if (
			presented !== undefined &&
			(await verifyDpopNonce({
				nonce: presented,
				secret: config.dpopNonce.secret
			}))
		) {
			return undefined;
		}
		const fresh = await mintDpopNonce({
			secret: config.dpopNonce.secret
		});

		return new Response(JSON.stringify({ error: 'use_dpop_nonce' }), {
			headers: {
				'content-type': 'application/json',
				'dpop-nonce': fresh,
				'www-authenticate': 'DPoP error="use_dpop_nonce"'
			},
			status: HTTP_UNAUTHORIZED
		});
	};

	const grantAuthorizationCode = async (
		client: OAuthClient,
		body: Record<string, string | undefined>,
		dpop: string | undefined,
		clientCertThumbprint: string | undefined
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
				acr: record.acr,
				claims: record.claims,
				clientCertThumbprint,
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
		dpop: string | undefined,
		clientCertThumbprint: string | undefined
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
				acr: record.acr,
				claims: record.claims,
				clientCertThumbprint,
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

	const grantBackchannel = async (
		client: OAuthClient,
		body: Record<string, string | undefined>,
		dpop: string | undefined,
		clientCertThumbprint: string | undefined
	) => {
		if (config.backchannelAuthStore === undefined) {
			return oauthError(HTTP_BAD_REQUEST, 'unsupported_grant_type');
		}
		if (body.auth_req_id === undefined) {
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

		const result = await exchangeBackchannelAuth({
			authReqId: body.auth_req_id,
			clientCertThumbprint,
			clientId: client.clientId,
			config,
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
	if (config.backchannelAuthStore) {
		grantTypes.push(CIBA_GRANT_TYPE);
	}
	if (config.vciConfig !== undefined) {
		grantTypes.push(PRE_AUTHORIZED_CODE_GRANT);
	}

	const discovery: Record<string, boolean | string | string[]> = {
		authorization_endpoint: `${issuer}${authorizeRoute}`,
		authorization_response_iss_parameter_supported: true,
		backchannel_logout_session_supported: false,
		backchannel_logout_supported: true,
		code_challenge_methods_supported: ['S256'],
		client_id_metadata_document_supported:
			config.resolveClientIdMetadata !== undefined,
		dpop_signing_alg_values_supported: ['ES256'],
		end_session_endpoint: `${issuer}${endSessionRoute}`,
		grant_types_supported: grantTypes,
		id_token_signing_alg_values_supported: ['ES256'],
		introspection_endpoint: `${issuer}${introspectRoute}`,
		issuer,
		jwks_uri: `${issuer}${jwksRoute}`,
		// RFC 9101 — JAR (signed request objects).
		request_object_signing_alg_values_supported: ['ES256'],
		request_parameter_supported: true,
		require_signed_request_object_supported: true,
		response_modes_supported: ['query', 'form_post'],
		response_types_supported: ['code'],
		revocation_endpoint: `${issuer}${revokeRoute}`,
		subject_types_supported: ['public'],
		tls_client_certificate_bound_access_tokens: true,
		token_endpoint: tokenUrl,
		token_endpoint_auth_methods_supported:
			config.strictFapi === true
				? // FAPI 2.0 baseline (RFC 9700) bans shared-secret client auth.
					['private_key_jwt', 'self_signed_tls_client_auth']
				: [
						'client_secret_basic',
						'client_secret_post',
						'none',
						'private_key_jwt',
						'self_signed_tls_client_auth'
					],
		token_endpoint_auth_signing_alg_values_supported: ['ES256'],
		userinfo_endpoint: `${issuer}${userinfoRoute}`
	};
	if (config.deviceAuthorizationStore) {
		discovery.device_authorization_endpoint = `${issuer}${deviceAuthorizationRoute}`;
	}
	if (config.strictFapi === true) {
		// FAPI 2.0 baseline requires PAR for every client; flip the discovery
		// flag so RPs running compliance checks see the requirement.
		discovery.require_pushed_authorization_requests = true;
	}
	if (config.backchannelAuthStore) {
		// OIDC CIBA Core 1.0 §4 discovery metadata.
		discovery.backchannel_authentication_endpoint = `${issuer}${backchannelAuthorizationRoute}`;
		discovery.backchannel_token_delivery_modes_supported = ['poll'];
		discovery.backchannel_user_code_parameter_supported = false;
	}
	if (config.clientRegistrationTokenStore !== undefined) {
		discovery.registration_endpoint = registrationBaseUrl;
	}
	if (config.pushedAuthorizationRequestStore !== undefined) {
		discovery.pushed_authorization_request_endpoint = `${issuer}${parRoute}`;
		discovery.require_pushed_authorization_requests_supported = true;
	}
	if (
		config.acrValuesSupported !== undefined &&
		config.acrValuesSupported.length > 0
	) {
		discovery.acr_values_supported = config.acrValuesSupported;
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
			clientId === undefined ? undefined : await resolveClient(clientId);
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
		if (query.state !== undefined)
			url.searchParams.set('state', query.state);

		return redirectTo(url.toString());
	};

	return (
		new Elysia()
			.use(sessionStore<UserType>())
			.get(
				authorizeRoute,
				async ({
					cookie: { user_session_id },
					query,
					request,
					store
				}) => {
					// If the caller pushed the request first (RFC 9126), look up the stashed
					// params + use those — `client_id` may still be in the query, but every
					// other authorize param comes from the PAR record.
					let effectiveQuery: Record<string, string | undefined> =
						query;
					if (
						query.request_uri !== undefined &&
						config.pushedAuthorizationRequestStore !== undefined &&
						query.client_id !== undefined
					) {
						const pushed = await consumePushedRequest({
							clientId: query.client_id,
							requestUri: query.request_uri,
							store: config.pushedAuthorizationRequestStore
						});
						if (pushed === undefined) {
							return jsonResponse(
								{ error: 'invalid_request_uri' },
								HTTP_BAD_REQUEST
							);
						}
						effectiveQuery = pushed;
					} else if (
						query.request_uri !== undefined &&
						query.request_uri.startsWith(REQUEST_URI_PREFIX)
					) {
						// Caller passed a request_uri shape but PAR isn't configured.
						return jsonResponse(
							{ error: 'invalid_request_uri' },
							HTTP_BAD_REQUEST
						);
					}

					const initialClientId = effectiveQuery.client_id;
					const initialClient =
						initialClientId === undefined
							? undefined
							: await resolveClient(initialClientId);

					// RFC 9101 — if the caller passed `request=<jwt>`, the signed JWT's
					// payload REPLACES every other authorize param. We can only verify the
					// signature once we know which client claims to be sending it (from the
					// query's `client_id`), so this happens after the initial client lookup
					// + before the param destructure that drives the rest of the flow.
					if (
						effectiveQuery.request !== undefined &&
						initialClient !== undefined
					) {
						const parsed = await parseSignedRequestObject({
							client: initialClient,
							expectedIssuer: issuer,
							jwt: effectiveQuery.request
						});
						if (!parsed.ok) {
							return jsonResponse(
								{ error: parsed.error },
								HTTP_BAD_REQUEST
							);
						}
						// Carry the original client_id through so the rest of the flow
						// sees a consistent identity (the request JWT's iss is also the
						// client_id per parseSignedRequestObject's iss check).
						effectiveQuery = {
							...parsed.params,
							client_id: initialClientId
						};
					}

					const {
						client_id: clientId,
						code_challenge: codeChallenge,
						code_challenge_method: codeChallengeMethod,
						nonce,
						redirect_uri: redirectUri,
						response_mode: requestedResponseMode,
						response_type: responseType,
						scope,
						state
					} = effectiveQuery;

					const client = initialClient;
					if (
						client === undefined ||
						clientId !== client.clientId ||
						redirectUri === undefined ||
						!client.redirectUris.includes(redirectUri)
					) {
						return jsonResponse(
							{ error: 'invalid_client' },
							HTTP_BAD_REQUEST
						);
					}

					// Default response_mode follows the spec: 'query' for
					// response_type=code (what we support). 'form_post' is opt-in
					// via the query param.
					const responseMode =
						requestedResponseMode === 'form_post'
							? 'form_post'
							: 'query';
					if (
						requestedResponseMode !== undefined &&
						requestedResponseMode !== 'query' &&
						requestedResponseMode !== 'form_post'
					) {
						return jsonResponse(
							{ error: 'unsupported_response_mode' },
							HTTP_BAD_REQUEST
						);
					}

					const errorRedirect = (error: string) => {
						// RFC 9207 — include the issuer identifier so RPs can
						// detect mix-up attacks where another authorization
						// server's response is redirected to them.
						const params: Record<string, string> = {
							error,
							iss: issuer
						};
						if (state !== undefined) params.state = state;

						return respondToClient(
							redirectUri,
							responseMode,
							params
						);
					};
					// FAPI hardening: clients that opted into PAR-only can't sneak in via a
					// plain /authorize call — must have come through the PAR path above (which
					// rewrites effectiveQuery from the stored bag, so we detect it by checking
					// whether the original query carried `request_uri`).
					// `strictFapi` widens this to ALL clients (FAPI 2.0 baseline requires PAR).
					const requirePar =
						client.requirePushedAuthorizationRequests === true ||
						config.strictFapi === true;
					if (requirePar && query.request_uri === undefined) {
						return errorRedirect('invalid_request');
					}
					// FAPI hardening: clients that opted into signed-only requests must use
					// JAR — plain query-only `/authorize` (no `request=` and no `request_uri=`)
					// gets rejected with the spec-named error.
					if (
						client.requireSignedRequestObject === true &&
						query.request === undefined &&
						query.request_uri === undefined
					) {
						return errorRedirect('invalid_request_object');
					}
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

					// OIDC `prompt`/`max_age`/`id_token_hint` re-auth handling.
					// - prompt=none: never show login — caller can only get the response if
					//   already authenticated AND no other re-auth signal fires.
					// - prompt=login (or =consent): force a fresh authentication even if a
					//   session exists.
					// - max_age=N: if the current session was authenticated more than N
					//   seconds ago, treat as needing re-auth.
					// - id_token_hint: if the hint decodes to a different `sub` than the
					//   current session's user, treat as needing re-auth.
					const promptValues =
						effectiveQuery.prompt === undefined
							? []
							: effectiveQuery.prompt.split(' ');
					const wantsSilent = promptValues.includes('none');
					const wantsLogin =
						promptValues.includes('login') ||
						promptValues.includes('consent');
					const maxAge =
						effectiveQuery.max_age === undefined
							? undefined
							: Number(effectiveQuery.max_age);
					const sessionStaleByMaxAge =
						userSession !== undefined &&
						maxAge !== undefined &&
						!Number.isNaN(maxAge) &&
						maxAge >= 0 &&
						(userSession.authenticatedAt ?? 0) <
							Date.now() - maxAge * 1000;
					const hintSub =
						effectiveQuery.id_token_hint === undefined
							? undefined
							: (
									await verifyIdTokenHint({
										config,
										idTokenHint:
											effectiveQuery.id_token_hint
									})
								)?.sub;
					const hintMismatch =
						userSession !== undefined &&
						hintSub !== undefined &&
						hintSub !== getUserId(userSession.user);
					const needsReauth =
						wantsLogin || sessionStaleByMaxAge || hintMismatch;

					if (userSession === undefined || needsReauth) {
						if (wantsSilent) {
							return errorRedirect(
								userSession === undefined
									? 'login_required'
									: 'interaction_required'
							);
						}

						return loginUrl === undefined
							? jsonResponse(
									{ error: 'login_required' },
									HTTP_UNAUTHORIZED
								)
							: redirectTo(
									`${loginUrl}?return_to=${encodeURIComponent(canonicalizeRequestUrl(request.url, issuer))}`
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
					// Consumer-owned consent screen: bounce to it before any code is
					// issued when the user hasn't approved this client yet.
					if (
						config.consentUrl !== undefined &&
						(await config.needsConsent?.({
							client: {
								clientId: client.clientId,
								name: client.name
							},
							requestedScopes: requested,
							user: userSession.user
						})) === true
					) {
						const consentTarget = new URL(
							config.consentUrl,
							issuer
						);
						consentTarget.searchParams.set(
							'return_to',
							canonicalizeRequestUrl(request.url, issuer)
						);
						consentTarget.searchParams.set(
							'client_id',
							client.clientId
						);
						consentTarget.searchParams.set(
							'client_name',
							client.name
						);
						consentTarget.searchParams.set(
							'scope',
							requested.join(' ')
						);

						return redirectTo(consentTarget.toString());
					}

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

					// RFC 9470 — if the RP asked for a specific authentication level
					// (`acr_values`), the user's effective ACR must match one of them.
					// Otherwise the RP gets `insufficient_user_authentication` so it can
					// drive a step-up flow.
					const userAcr = config.getAcr?.({
						scopes: granted,
						user: userSession.user
					});
					const requestedAcr =
						effectiveQuery.acr_values === undefined ||
						effectiveQuery.acr_values.length === 0
							? undefined
							: effectiveQuery.acr_values
									.split(' ')
									.filter((entry) => entry.length > 0);
					if (
						requestedAcr !== undefined &&
						(userAcr === undefined ||
							!requestedAcr.includes(userAcr))
					) {
						return errorRedirect(
							'insufficient_user_authentication'
						);
					}

					const code = generateSecureToken(TOKEN_BYTES);
					await authorizationCodeStore.saveCode({
						acr: userAcr,
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

					const params: Record<string, string> = {
						code,
						// RFC 9207 — mix-up attack defense.
						iss: issuer
					};
					if (state !== undefined) params.state = state;

					return respondToClient(redirectUri, responseMode, params);
				},
				{
					cookie: t.Cookie({
						user_session_id: t.Optional(userSessionIdTypebox)
					}),
					query: t.Object({
						acr_values: t.Optional(t.String()),
						claims: t.Optional(t.String()),
						client_id: t.Optional(t.String()),
						code_challenge: t.Optional(t.String()),
						code_challenge_method: t.Optional(t.String()),
						id_token_hint: t.Optional(t.String()),
						max_age: t.Optional(t.String()),
						nonce: t.Optional(t.String()),
						prompt: t.Optional(t.String()),
						redirect_uri: t.Optional(t.String()),
						request: t.Optional(t.String()),
						request_uri: t.Optional(t.String()),
						response_mode: t.Optional(t.String()),
						response_type: t.Optional(t.String()),
						scope: t.Optional(t.String()),
						state: t.Optional(t.String())
					})
				}
			)
			.post(
				tokenRoute,
				async ({ body, headers, request }) => {
					// OID4VCI §3.5 — the pre-authorized_code grant is the wallet's auth material;
					// no client_id / client_secret. Route it before authenticateTokenClient so a
					// public wallet client doesn't get a `invalid_client` on a clean token call.
					if (
						body.grant_type === PRE_AUTHORIZED_CODE_GRANT &&
						config.vciConfig !== undefined
					) {
						const preAuthorizedCode = body['pre-authorized_code'];
						if (typeof preAuthorizedCode !== 'string') {
							return oauthError(
								HTTP_BAD_REQUEST,
								'invalid_request'
							);
						}
						const result = await exchangePreAuthorizedCode({
							config: config.vciConfig,
							issuer: config.issuer,
							preAuthorizedCode,
							signingKey:
								config.vciConfig.signingKey ?? config.signingKey
						});
						if (!result.ok)
							return oauthError(HTTP_BAD_REQUEST, result.error);

						return jsonResponse(
							{
								access_token: result.access_token,
								c_nonce: result.c_nonce,
								c_nonce_expires_in: result.c_nonce_expires_in,
								expires_in: result.expires_in,
								token_type: result.token_type
							},
							HTTP_OK
						);
					}
					const basic = readBasicAuth(headers.authorization);
					const auth = await authenticateTokenClient({
						basicClientId: basic.clientId,
						basicClientSecret: basic.clientSecret,
						bodyClientAssertion: body.client_assertion,
						bodyClientAssertionType: body.client_assertion_type,
						bodyClientId: body.client_id,
						bodyClientSecret: body.client_secret,
						requestHeaders: request.headers
					});
					if (auth === undefined) {
						return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
					}
					const { client, clientCertThumbprint } = auth;
					const nonceChallenge = await dpopNonceChallenge(
						headers.dpop
					);
					if (nonceChallenge !== undefined) return nonceChallenge;

					if (body.grant_type === 'authorization_code') {
						return grantAuthorizationCode(
							client,
							body,
							headers.dpop,
							clientCertThumbprint
						);
					}
					if (body.grant_type === 'refresh_token') {
						return grantRefreshToken(
							client,
							body,
							headers.dpop,
							clientCertThumbprint
						);
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
					if (body.grant_type === CIBA_GRANT_TYPE) {
						return grantBackchannel(
							client,
							body,
							headers.dpop,
							clientCertThumbprint
						);
					}

					return oauthError(
						HTTP_BAD_REQUEST,
						'unsupported_grant_type'
					);
				},
				{
					body: t.Object({
						audience: t.Optional(t.String()),
						auth_req_id: t.Optional(t.String()),
						client_assertion: t.Optional(t.String()),
						client_assertion_type: t.Optional(t.String()),
						client_id: t.Optional(t.String()),
						client_secret: t.Optional(t.String()),
						code: t.Optional(t.String()),
						code_verifier: t.Optional(t.String()),
						device_code: t.Optional(t.String()),
						grant_type: t.Optional(t.String()),
						'pre-authorized_code': t.Optional(t.String()),
						redirect_uri: t.Optional(t.String()),
						refresh_token: t.Optional(t.String()),
						resource: t.Optional(t.String()),
						scope: t.Optional(t.String()),
						subject_token: t.Optional(t.String()),
						subject_token_type: t.Optional(t.String())
					})
				}
			)
			// RFC 9126 — Pushed Authorization Request. The RP POSTs the full authorize
			// param set, authenticated like the token endpoint. We stash under a 90s
			// opaque request_uri (urn:ietf:params:oauth:request_uri:<token>); /authorize
			// replays it. The point: request params never traverse the user-agent.
			.post(
				parRoute,
				async ({ body, headers, request }) => {
					if (config.pushedAuthorizationRequestStore === undefined) {
						return oauthError(
							HTTP_NOT_IMPLEMENTED,
							'unsupported_response_type'
						);
					}
					const basic = readBasicAuth(headers.authorization);
					const auth = await authenticateTokenClient({
						basicClientId: basic.clientId,
						basicClientSecret: basic.clientSecret,
						bodyClientAssertion: body.client_assertion,
						bodyClientAssertionType: body.client_assertion_type,
						bodyClientId: body.client_id,
						bodyClientSecret: body.client_secret,
						requestHeaders: request.headers
					});
					if (auth === undefined) {
						return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
					}
					const { client } = auth;
					// Strip Optional `undefined`s + client auth fields so the persisted
					// param bag is a clean `Record<string, string>` (jsonb-friendly + matches
					// what /authorize will look up).
					const isAuthField = (key: string) =>
						key === 'client_assertion' ||
						key === 'client_assertion_type' ||
						key === 'client_secret';
					const params: Record<string, string> = Object.fromEntries(
						Object.entries(body).filter(
							(entry): entry is [string, string] =>
								typeof entry[1] === 'string' &&
								!isAuthField(entry[0])
						)
					);
					const result = await pushAuthorizationRequest({
						client,
						params,
						store: config.pushedAuthorizationRequestStore,
						ttlMs: config.pushedAuthorizationRequestTtlMs
					});

					return jsonResponse(
						result.body,
						result.ok ? HTTP_OK : result.status
					);
				},
				{
					body: t.Object({
						acr_values: t.Optional(t.String()),
						audience: t.Optional(t.String()),
						claims: t.Optional(t.String()),
						client_assertion: t.Optional(t.String()),
						client_assertion_type: t.Optional(t.String()),
						client_id: t.Optional(t.String()),
						client_secret: t.Optional(t.String()),
						code_challenge: t.Optional(t.String()),
						code_challenge_method: t.Optional(t.String()),
						nonce: t.Optional(t.String()),
						redirect_uri: t.Optional(t.String()),
						resource: t.Optional(t.String()),
						response_type: t.Optional(t.String()),
						scope: t.Optional(t.String()),
						state: t.Optional(t.String())
					}),
					headers: t.Object({
						authorization: t.Optional(t.String())
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
					const clientSecret =
						body.client_secret ?? basic.clientSecret;
					if (clientId === undefined) {
						return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
					}
					const client = await authenticateClient(
						clientId,
						clientSecret
					);
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
					const clientSecret =
						body.client_secret ?? basic.clientSecret;
					if (clientId === undefined) {
						return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
					}
					const client = await authenticateClient(
						clientId,
						clientSecret
					);
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
			// OIDC CIBA Core 1.0 §7.1 — backchannel authorization request. Clients
			// hit this with a login_hint identifying the user; the package resolves
			// the user via `resolveBackchannelUser`, persists a pending auth_req,
			// fires `onBackchannelAuthRequest` so the consumer can push a notification
			// to the user's phone, and returns an auth_req_id the client polls
			// /token with (grant_type=urn:openid:params:grant-type:ciba).
			.post(
				backchannelAuthorizationRoute,
				async ({ body, headers }) => {
					if (config.backchannelAuthStore === undefined) {
						return oauthError(
							HTTP_BAD_REQUEST,
							'unsupported_grant_type'
						);
					}
					const basic = readBasicAuth(headers.authorization);
					const clientId = body.client_id ?? basic.clientId;
					const clientSecret =
						body.client_secret ?? basic.clientSecret;
					if (clientId === undefined) {
						return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
					}
					const client = await authenticateClient(
						clientId,
						clientSecret
					);
					if (client === undefined) {
						return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
					}
					if (body.login_hint === undefined) {
						return oauthError(HTTP_BAD_REQUEST, 'invalid_request');
					}
					const requested =
						body.scope === undefined || body.scope.length === 0
							? client.scopes
							: body.scope
									.split(' ')
									.filter((entry) =>
										client.scopes.includes(entry)
									);
					const result = await issueBackchannelAuth({
						bindingMessage: body.binding_message,
						clientId: client.clientId,
						config,
						loginHint: body.login_hint,
						now: Date.now(),
						requestedScopes: requested
					});
					if (!result.ok)
						return oauthError(HTTP_BAD_REQUEST, result.error);

					return jsonResponse(
						{
							auth_req_id: result.auth_req_id,
							expires_in: result.expires_in,
							interval: result.interval
						},
						HTTP_OK
					);
				},
				{
					body: t.Object({
						binding_message: t.Optional(t.String()),
						client_id: t.Optional(t.String()),
						client_secret: t.Optional(t.String()),
						login_hint: t.Optional(t.String()),
						scope: t.Optional(t.String())
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
						return oauthError(
							HTTP_BAD_REQUEST,
							'unsupported_grant_type'
						);
					}
					const basic = readBasicAuth(headers.authorization);
					const clientId = body.client_id ?? basic.clientId;
					const clientSecret =
						body.client_secret ?? basic.clientSecret;
					if (clientId === undefined) {
						return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
					}
					const client = await authenticateClient(
						clientId,
						clientSecret
					);
					if (client === undefined) {
						return oauthError(HTTP_UNAUTHORIZED, 'invalid_client');
					}
					const requested =
						body.scope === undefined || body.scope.length === 0
							? client.scopes
							: body.scope
									.split(' ')
									.filter((entry) =>
										client.scopes.includes(entry)
									);
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
						return oauthError(
							HTTP_BAD_REQUEST,
							'unsupported_grant_type'
						);
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
					if (!result.ok)
						return oauthError(HTTP_BAD_REQUEST, result.error);

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
				async ({ cookie: { user_session_id }, query, store }) =>
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
				async ({ body, cookie: { user_session_id }, store }) =>
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
			// RFC 7591 — Dynamic Client Registration. The route is mounted unconditionally,
			// but returns 501 when the registration token store isn't configured — that way
			// /.well-known/openid-configuration's discovery flag stays the source of truth on
			// whether DCR is on at this deployment.
			.post(
				registrationRoute,
				async ({ body, headers }) => {
					if (config.clientRegistrationTokenStore === undefined) {
						return jsonResponse(
							{ error: 'unsupported_response_type' },
							HTTP_NOT_IMPLEMENTED
						);
					}
					const presented = headers.authorization?.startsWith(
						'Bearer '
					)
						? headers.authorization.slice('Bearer '.length).trim()
						: undefined;
					const result = await registerClient({
						clientStore,
						initialAccessTokenStore: config.initialAccessTokenStore,
						metadata: body,
						onClientRegistered: config.onClientRegistered,
						onClientRegistration: config.onClientRegistration,
						presentedInitialAccessToken: presented,
						registrationBaseUrl,
						registrationTokenStore:
							config.clientRegistrationTokenStore
					});

					return jsonResponse(
						result.body,
						result.ok ? HTTP_OK : result.status
					);
				},
				{
					body: t.Object({
						backchannel_logout_uri: t.Optional(t.String()),
						client_name: t.Optional(t.String()),
						grant_types: t.Optional(t.Array(t.String())),
						jwks: t.Optional(t.Any()),
						jwks_uri: t.Optional(t.String()),
						post_logout_redirect_uris: t.Optional(
							t.Array(t.String())
						),
						redirect_uris: t.Optional(t.Array(t.String())),
						scope: t.Optional(t.String())
					}),
					headers: t.Object({
						authorization: t.Optional(t.String())
					})
				}
			)
			.get(
				`${registrationRoute}/:clientId`,
				async ({ headers, params: { clientId } }) => {
					if (config.clientRegistrationTokenStore === undefined) {
						return jsonResponse(
							{ error: 'unsupported_response_type' },
							HTTP_NOT_IMPLEMENTED
						);
					}
					const result = await getRegisteredClient({
						authorization: headers.authorization,
						clientId,
						clientStore,
						registrationTokenStore:
							config.clientRegistrationTokenStore
					});

					return jsonResponse(result.body, result.status);
				},
				{
					headers: t.Object({
						authorization: t.Optional(t.String())
					}),
					params: t.Object({ clientId: t.String() })
				}
			)
			.put(
				`${registrationRoute}/:clientId`,
				async ({ body, headers, params: { clientId } }) => {
					if (config.clientRegistrationTokenStore === undefined) {
						return jsonResponse(
							{ error: 'unsupported_response_type' },
							HTTP_NOT_IMPLEMENTED
						);
					}
					const result = await updateRegisteredClient({
						authorization: headers.authorization,
						clientId,
						clientStore,
						metadata: body,
						onClientRegistration: config.onClientRegistration,
						registrationTokenStore:
							config.clientRegistrationTokenStore
					});

					return jsonResponse(result.body, result.status);
				},
				{
					body: t.Object({
						backchannel_logout_uri: t.Optional(t.String()),
						client_name: t.Optional(t.String()),
						grant_types: t.Optional(t.Array(t.String())),
						jwks: t.Optional(t.Any()),
						jwks_uri: t.Optional(t.String()),
						post_logout_redirect_uris: t.Optional(
							t.Array(t.String())
						),
						redirect_uris: t.Optional(t.Array(t.String())),
						scope: t.Optional(t.String())
					}),
					headers: t.Object({
						authorization: t.Optional(t.String())
					}),
					params: t.Object({ clientId: t.String() })
				}
			)
			.delete(
				`${registrationRoute}/:clientId`,
				async ({ headers, params: { clientId } }) => {
					if (config.clientRegistrationTokenStore === undefined) {
						return jsonResponse(
							{ error: 'unsupported_response_type' },
							HTTP_NOT_IMPLEMENTED
						);
					}
					const result = await deleteRegisteredClient({
						authorization: headers.authorization,
						clientId,
						clientStore,
						registrationTokenStore:
							config.clientRegistrationTokenStore
					});
					if (result.status === HTTP_NO_CONTENT) {
						return new Response(null, { status: HTTP_NO_CONTENT });
					}

					return jsonResponse(result.body, result.status);
				},
				{
					headers: t.Object({
						authorization: t.Optional(t.String())
					}),
					params: t.Object({ clientId: t.String() })
				}
			)
			// OIDC `/userinfo`. RP presents Bearer access token; we verify (our sig + exp),
			// optionally enrich via `getUserInfo(sub)` hook, return JSON. Always returns at
			// least `{sub}`. WWW-Authenticate on errors per RFC 6750.
			.get(
				userinfoRoute,
				async ({ headers }) => {
					const token = readUserInfoBearer(headers.authorization);
					const result = await fetchUserInfo({ config, token });
					if (!result.ok) {
						return new Response(JSON.stringify(result.body), {
							headers: {
								'content-type': 'application/json',
								'www-authenticate': userInfoChallengeHeader(
									result.error
								)
							},
							status: HTTP_UNAUTHORIZED
						});
					}

					return jsonResponse(result.body, HTTP_OK);
				},
				{
					headers: t.Object({
						authorization: t.Optional(t.String())
					})
				}
			)
			.post(
				userinfoRoute,
				async ({ headers, body }) => {
					// Per spec, /userinfo accepts the token in the Authorization header OR
					// the `access_token` form field. The form-field path lets RPs that can't
					// set custom headers (rare today) still use it.
					const token =
						readUserInfoBearer(headers.authorization) ??
						body.access_token;
					const result = await fetchUserInfo({ config, token });
					if (!result.ok) {
						return new Response(JSON.stringify(result.body), {
							headers: {
								'content-type': 'application/json',
								'www-authenticate': userInfoChallengeHeader(
									result.error
								)
							},
							status: HTTP_UNAUTHORIZED
						});
					}

					return jsonResponse(result.body, HTTP_OK);
				},
				{
					body: t.Object({
						access_token: t.Optional(t.String())
					}),
					headers: t.Object({
						authorization: t.Optional(t.String())
					})
				}
			)
			.get(jwksRoute, () => ({ keys: [toPublicJwk(signingKey)] }))
			.get('/.well-known/openid-configuration', () => discovery)
			// RFC 8414 alias — OAuth 2.0 Authorization Server Metadata. Same document;
			// MCP clients and plain-OAuth tooling fetch this path instead of the OIDC one.
			.get('/.well-known/oauth-authorization-server', () => discovery)
	);
};
