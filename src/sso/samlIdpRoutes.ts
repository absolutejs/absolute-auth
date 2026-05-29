// SAML 2.0 IdP role — the inverse of `samlRoutes.ts`.
//
// The existing samlRoutes makes the package a SAML **SP** (consumer of IdP-issued
// assertions from Okta/Microsoft Entra/etc.). These routes make it a SAML **IdP** —
// issuer of assertions to legacy SaaS RPs (Salesforce, Workday, Concur, anything older
// than OIDC). Same delegation philosophy: package owns the route wiring + SP store +
// URL building; consumer plugs in an idpAdapter for the XML signing/parsing.
//
// Routes mounted:
//   POST /sso/saml/idp/sso        — HTTP-POST binding (most common)
//   GET  /sso/saml/idp/sso        — HTTP-Redirect binding (also accepts ?SAMLRequest=)
//   GET  /sso/saml/idp/sso/initiate?serviceProvider=<entityId>  — IdP-initiated SSO (no AuthnRequest)
//   GET  /sso/saml/idp/metadata   — IdP metadata XML
//
// The SP is identified by the Issuer in the AuthnRequest (POST/Redirect) or the `serviceProvider=`
// query param (IdP-initiated). The package looks it up in samlServiceProviderStore;
// returns 400 if unknown, redirects to login if no session, and finally renders an
// XHTML auto-POST form (from the adapter) that ships SAMLResponse to the SP's ACS URL.

import { Elysia, t } from 'elysia';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import type { AuthSessionStore } from '../session/types';
import { userSessionIdTypebox } from '../typebox';
import type { RouteString, SessionRecord, UserSessionId } from '../types';
import { DEFAULT_SSO_ROUTE, type SamlIdpAdapter } from './config';
import type { SamlServiceProviderStore } from './types';

type SamlIdpRoutesProps<UserType> = {
	authSessionStore?: AuthSessionStore<UserType>;
	getNameId: (user: UserType) => string;
	getSamlAttributes?: (user: UserType) => Record<string, unknown>;
	idpAdapter: SamlIdpAdapter;
	idpEntityId: string;
	// Where to send the user when no session exists (mirrors the OIDC `loginUrl`).
	loginUrl?: string;
	samlServiceProviderStore: SamlServiceProviderStore;
	ssoRoute?: RouteString;
};

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FOUND = 302;
const HTTP_OK = 200;

const xmlResponse = (body: string) =>
	new Response(body, {
		headers: { 'content-type': 'application/samlmetadata+xml' },
		status: HTTP_OK
	});

const htmlResponse = (body: string) =>
	new Response(body, {
		headers: { 'content-type': 'text/html; charset=utf-8' },
		status: HTTP_OK
	});

const redirectTo = (url: string) =>
	new Response(null, { headers: { location: url }, status: HTTP_FOUND });

const errorJson = (status: number, error: string) =>
	new Response(JSON.stringify({ error }), {
		headers: { 'content-type': 'application/json' },
		status
	});

export const samlIdpRoutes = <UserType>({
	authSessionStore,
	getNameId,
	getSamlAttributes,
	idpAdapter,
	idpEntityId,
	loginUrl,
	samlServiceProviderStore,
	ssoRoute = DEFAULT_SSO_ROUTE
}: SamlIdpRoutesProps<UserType>) => {
	const ssoIdpRoute: RouteString = `${ssoRoute}/saml/idp/sso`;
	const idpInitiateRoute: RouteString = `${ssoRoute}/saml/idp/sso/initiate`;
	const idpMetadataRoute: RouteString = `${ssoRoute}/saml/idp/metadata`;

	const ssoUrlFor = (requestUrl: string) =>
		`${new URL(requestUrl).origin}${ssoIdpRoute}`;

	const renderResponse = async ({
		acsUrl,
		inResponseTo,
		relayState,
		serviceProviderEntityId,
		user
	}: {
		acsUrl: string;
		inResponseTo?: string;
		relayState?: string;
		serviceProviderEntityId: string;
		user: UserType;
	}) => {
		const samlResponse = await idpAdapter.createSamlResponse({
			acsUrl,
			attributes: getSamlAttributes?.(user),
			audience: serviceProviderEntityId,
			idpEntityId,
			inResponseTo,
			nameId: getNameId(user),
			sessionIndex: crypto.randomUUID()
		});
		const html = idpAdapter.buildAutoPostForm({
			acsUrl,
			relayState,
			samlResponse
		});

		return htmlResponse(html);
	};

	const handleSpInitiated = async ({
		binding,
		body,
		inMemorySession,
		request,
		userSessionIdValue
	}: {
		binding: 'POST' | 'Redirect';
		body: Record<string, string | undefined>;
		inMemorySession: SessionRecord<UserType>;
		request: Request;
		userSessionIdValue: UserSessionId | undefined;
	}) => {
		if (body.SAMLRequest === undefined) {
			return errorJson(HTTP_BAD_REQUEST, 'missing_saml_request');
		}
		// Need the SP to validate the signature against — but we don't know which SP
		// without parsing the request. Two-pass: first parse without sig check to
		// learn the issuer, then re-validate with the SP's cert.
		let firstPass;
		try {
			firstPass = await idpAdapter.parseAuthnRequest({
				binding,
				samlRequest: body.SAMLRequest
			});
		} catch {
			return errorJson(HTTP_BAD_REQUEST, 'invalid_authn_request');
		}
		const serviceProvider =
			await samlServiceProviderStore.findServiceProvider(
				firstPass.issuer
			);
		if (serviceProvider === undefined) {
			return errorJson(HTTP_BAD_REQUEST, 'unknown_service_provider');
		}
		let parsed;
		try {
			parsed = await idpAdapter.parseAuthnRequest({
				binding,
				samlRequest: body.SAMLRequest,
				serviceProvider: serviceProvider,
				signature: body.Signature,
				signatureAlgorithm: body.SigAlg,
				signedQueryString:
					binding === 'Redirect'
						? new URL(request.url).search.slice(1)
						: undefined
			});
		} catch {
			return errorJson(HTTP_BAD_REQUEST, 'invalid_authn_request');
		}

		const userSession = await loadSessionFromSource<UserType>({
			authSessionStore,
			session: inMemorySession,
			userSessionId: userSessionIdValue
		});
		if (userSession === undefined || parsed.forceAuthn === true) {
			if (loginUrl === undefined) {
				return errorJson(HTTP_UNAUTHORIZED, 'login_required');
			}

			return redirectTo(
				`${loginUrl}?return_to=${encodeURIComponent(request.url)}`
			);
		}

		return renderResponse({
			acsUrl: parsed.acsUrl ?? serviceProvider.acsUrl,
			inResponseTo: parsed.id,
			relayState: parsed.relayState ?? body.RelayState,
			serviceProviderEntityId: serviceProvider.entityId,
			user: userSession.user
		});
	};

	return new Elysia()
		.use(sessionStore<UserType>())
		.post(
			ssoIdpRoute,
			async ({ body, cookie: { user_session_id }, request, store }) =>
				handleSpInitiated({
					binding: 'POST',
					body,
					inMemorySession: store.session,
					request,
					userSessionIdValue: user_session_id.value
				}),
			{
				body: t.Object({
					RelayState: t.Optional(t.String()),
					SAMLRequest: t.Optional(t.String())
				}),
				cookie: t.Cookie({
					user_session_id: t.Optional(userSessionIdTypebox)
				})
			}
		)
		.get(
			ssoIdpRoute,
			async ({ cookie: { user_session_id }, query, request, store }) =>
				handleSpInitiated({
					binding: 'Redirect',
					body: query,
					inMemorySession: store.session,
					request,
					userSessionIdValue: user_session_id.value
				}),
			{
				cookie: t.Cookie({
					user_session_id: t.Optional(userSessionIdTypebox)
				}),
				query: t.Object({
					RelayState: t.Optional(t.String()),
					SAMLRequest: t.Optional(t.String()),
					SigAlg: t.Optional(t.String()),
					Signature: t.Optional(t.String())
				})
			}
		)
		.get(
			idpInitiateRoute,
			async ({
				cookie: { user_session_id },
				query: { sp: serviceProviderEntityId, RelayState: relayState },
				request,
				store
			}) => {
				if (serviceProviderEntityId === undefined) {
					return errorJson(HTTP_BAD_REQUEST, 'missing_sp');
				}
				const serviceProvider =
					await samlServiceProviderStore.findServiceProvider(
						serviceProviderEntityId
					);
				if (serviceProvider === undefined) {
					return errorJson(
						HTTP_BAD_REQUEST,
						'unknown_service_provider'
					);
				}
				const userSession =
					authSessionStore === undefined
						? await loadSessionFromSource({
								session: store.session,
								userSessionId: user_session_id.value
							})
						: await loadSessionFromSource({
								authSessionStore,
								session: store.session,
								userSessionId: user_session_id.value
							});
				if (userSession === undefined) {
					if (loginUrl === undefined) {
						return errorJson(HTTP_UNAUTHORIZED, 'login_required');
					}

					return redirectTo(
						`${loginUrl}?return_to=${encodeURIComponent(request.url)}`
					);
				}

				return renderResponse({
					acsUrl: serviceProvider.acsUrl,
					relayState,
					serviceProviderEntityId: serviceProvider.entityId,
					user: userSession.user
				});
			},
			{
				cookie: t.Cookie({
					user_session_id: t.Optional(userSessionIdTypebox)
				}),
				query: t.Object({
					RelayState: t.Optional(t.String()),
					sp: t.Optional(t.String())
				})
			}
		)
		.get(idpMetadataRoute, async ({ request }) =>
			xmlResponse(
				await idpAdapter.getIdpMetadata({
					entityId: idpEntityId,
					ssoUrl: ssoUrlFor(request.url)
				})
			)
		);
};
