import { Elysia, t } from 'elysia';
import { createSessionCompatibilityLayer } from '../session/access';
import { clearSession, promoteToSession } from '../session/promote';
import { sessionStore } from '../session/state';
import type { AuthSessionStore } from '../session/types';
import { isNonEmptyString } from '../typeGuards';
import { userSessionIdTypebox } from '../typebox';
import type { RouteString, SessionRecord, UserSessionId } from '../types';
import {
	DEFAULT_SSO_ROUTE,
	DEFAULT_SSO_SESSION_TTL_MS,
	type SamlAdapter,
	type SsoIdentity,
	type SSOConfig
} from './config';

type SamlRoutesProps<UserType> = SSOConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
	cookieSecure?: boolean;
	samlAdapter: SamlAdapter;
};

// RelayState is round-tripped through the IdP and not signed, so it is only ever used as a
// local post-login redirect path (never an absolute URL — guards against open redirects).
const toLocalPath = (value: string | undefined) => {
	if (value === undefined || value.length === 0) return '/';

	return value.startsWith('/') && !value.startsWith('//') ? value : '/';
};

const refererPath = (referer: string | undefined) => {
	if (referer === undefined) return '/';

	try {
		return toLocalPath(new URL(referer).pathname);
	} catch {
		return toLocalPath(referer);
	}
};

// Run an adapter call, returning either its value or the thrown error — keeps the SLO route
// flat (no nested try/catch) so the validation branches stay within the max-depth budget.
const settle = async <Value>(work: Value | Promise<Value>) => {
	try {
		return { value: await work };
	} catch (error) {
		return { error };
	}
};

export const samlSsoRoutes = <UserType>({
	authSessionStore,
	cookieSecure,
	getSsoUser,
	onSsoCallbackError,
	onSsoCallbackSuccess,
	samlAdapter,
	sessionDurationMs = DEFAULT_SSO_SESSION_TTL_MS,
	ssoConnectionStore,
	ssoRoute = DEFAULT_SSO_ROUTE
}: SamlRoutesProps<UserType>) => {
	const authorizeRoute: RouteString = `${ssoRoute}/saml/:organizationId/authorize`;
	const acsRoute: RouteString = `${ssoRoute}/saml/:organizationId/acs`;
	const metadataRoute: RouteString = `${ssoRoute}/saml/:organizationId/metadata`;
	const logoutRoute: RouteString = `${ssoRoute}/saml/:organizationId/logout`;
	const sloRoute: RouteString = `${ssoRoute}/saml/:organizationId/slo`;

	const acsUrlFor = (requestUrl: string, organizationId: string) =>
		`${new URL(requestUrl).origin}${ssoRoute}/saml/${organizationId}/acs`;
	const sloUrlFor = (requestUrl: string, organizationId: string) =>
		`${new URL(requestUrl).origin}${ssoRoute}/saml/${organizationId}/slo`;

	// Read the SP-initiated SLO context stored on the session at the ACS, before it is cleared.
	const readSamlLogout = async (
		userSessionId: UserSessionId | undefined,
		inMemorySession: SessionRecord<UserType>
	) => {
		if (userSessionId === undefined) return undefined;
		const compatibilityLayer = await createSessionCompatibilityLayer({
			authSessionStore,
			userSessionId
		});
		const target = authSessionStore
			? compatibilityLayer.session
			: inMemorySession;

		return target[userSessionId]?.samlLogout;
	};

	return new Elysia()
		.use(sessionStore<UserType>())
		.get(
			authorizeRoute,
			async ({
				headers,
				params: { organizationId },
				redirect,
				request,
				status
			}) => {
				const connection =
					await ssoConnectionStore.getConnectionByOrganization(
						organizationId,
						'saml'
					);
				if (connection === undefined || connection.type !== 'saml') {
					return status(
						'Not Found',
						'No SAML connection is configured for this organization'
					);
				}

				const url = await samlAdapter.createAuthorizationUrl({
					acsUrl: acsUrlFor(request.url, organizationId),
					connection,
					relayState: refererPath(headers['referer'])
				});

				return redirect(url);
			},
			{ params: t.Object({ organizationId: t.String() }) }
		)
		.post(
			acsRoute,
			async ({
				body,
				cookie: { user_session_id },
				params: { organizationId },
				redirect,
				request,
				status,
				store: { session }
			}) => {
				const connection =
					await ssoConnectionStore.getConnectionByOrganization(
						organizationId,
						'saml'
					);
				if (connection === undefined || connection.type !== 'saml') {
					return status(
						'Not Found',
						'No SAML connection is configured for this organization'
					);
				}

				try {
					const profile = await samlAdapter.validateAssertion({
						acsUrl: acsUrlFor(request.url, organizationId),
						connection,
						relayState: body.RelayState,
						samlResponse: body.SAMLResponse
					});
					const identity: SsoIdentity = {
						attributes: profile.attributes,
						connection,
						email: profile.email,
						organizationId,
						protocol: 'saml',
						sessionIndex: profile.sessionIndex,
						sub: profile.nameId
					};

					const user = await getSsoUser(identity);
					const userSessionId = await promoteToSession({
						authSessionStore,
						cookie: user_session_id,
						cookieSecure,
						inMemorySession: session,
						samlLogout: {
							connectionId: connection.connectionId,
							nameId: profile.nameId,
							sessionIndex: profile.sessionIndex
						},
						sessionDurationMs,
						user
					});
					await onSsoCallbackSuccess?.({
						identity,
						user,
						userSessionId
					});

					return redirect(toLocalPath(body.RelayState));
				} catch (error) {
					await onSsoCallbackError?.({ error, organizationId });

					return status(
						'Internal Server Error',
						'SAML sign-in failed'
					);
				}
			},
			{
				body: t.Object({
					RelayState: t.Optional(t.String()),
					SAMLResponse: t.String()
				}),
				cookie: t.Cookie({
					user_session_id: t.Optional(userSessionIdTypebox)
				}),
				params: t.Object({ organizationId: t.String() })
			}
		)
		.get(
			metadataRoute,
			async ({ params: { organizationId }, request, status }) => {
				const connection =
					await ssoConnectionStore.getConnectionByOrganization(
						organizationId,
						'saml'
					);
				if (connection === undefined || connection.type !== 'saml') {
					return status(
						'Not Found',
						'No SAML connection is configured for this organization'
					);
				}

				const metadata = await samlAdapter.getServiceProviderMetadata({
					acsUrl: acsUrlFor(request.url, organizationId),
					connection,
					sloUrl: sloUrlFor(request.url, organizationId)
				});

				return new Response(metadata, {
					headers: { 'content-type': 'application/xml' }
				});
			},
			{ params: t.Object({ organizationId: t.String() }) }
		)
		.get(
			logoutRoute,
			// SP-initiated Single Logout: capture the SLO context, clear the local session, then
			// send a *signed* LogoutRequest (NameID + SessionIndex) to the IdP so it ends its own
			// session and redirects the browser back to `/slo` with a LogoutResponse. Falls back to
			// a plain redirect when the adapter or connection can't do signed SLO.
			async ({
				cookie: { user_session_id },
				params: { organizationId },
				redirect,
				request,
				store: { session }
			}) => {
				const connection =
					await ssoConnectionStore.getConnectionByOrganization(
						organizationId,
						'saml'
					);
				const idpSloUrl =
					connection?.type === 'saml'
						? connection.config.idpSloUrl
						: undefined;
				const logoutContext = await readSamlLogout(
					user_session_id.value,
					session
				);
				await clearSession({
					authSessionStore,
					cookie: user_session_id,
					inMemorySession: session
				});

				const buildLogoutRequest = samlAdapter.createLogoutRequestUrl;
				if (
					connection?.type === 'saml' &&
					idpSloUrl !== undefined &&
					buildLogoutRequest !== undefined &&
					logoutContext !== undefined &&
					logoutContext.connectionId === connection.connectionId
				) {
					const url = await buildLogoutRequest({
						connection,
						nameId: logoutContext.nameId,
						relayState: '/',
						sessionIndex: logoutContext.sessionIndex,
						sloUrl: sloUrlFor(request.url, organizationId)
					});

					return redirect(url);
				}

				return redirect(idpSloUrl ?? '/');
			},
			{
				cookie: t.Cookie({
					user_session_id: t.Optional(userSessionIdTypebox)
				}),
				params: t.Object({ organizationId: t.String() })
			}
		)
		.get(
			sloRoute,
			// The SLO endpoint: handles the IdP's LogoutResponse (completing an SP-initiated
			// logout) and IdP-initiated LogoutRequests (front-channel, via the user's browser).
			async ({
				cookie: { user_session_id },
				params: { organizationId },
				query: { RelayState, SAMLRequest, SAMLResponse, SigAlg, Signature },
				redirect,
				request,
				status,
				store: { session }
			}) => {
				const connection =
					await ssoConnectionStore.getConnectionByOrganization(
						organizationId,
						'saml'
					);
				if (connection === undefined || connection.type !== 'saml') {
					return status(
						'Not Found',
						'No SAML connection is configured for this organization'
					);
				}
				const sloUrl = sloUrlFor(request.url, organizationId);
				// The raw, still-encoded query string is what the IdP signed for the
				// HTTP-Redirect binding; the adapter needs it (plus Signature / SigAlg)
				// to verify the signature over the exact octet string.
				const signedQueryString = new URL(request.url).search.replace(
					/^\?/,
					''
				);

				if (isNonEmptyString(SAMLResponse)) {
					const responseSettled = await settle(
						samlAdapter.validateLogoutResponse?.({
							connection,
							relayState: RelayState,
							samlResponse: SAMLResponse,
							signature: Signature,
							signatureAlgorithm: SigAlg,
							signedQueryString,
							sloUrl
						}) ?? Promise.resolve()
					);
					if (!('error' in responseSettled)) {
						return redirect(toLocalPath(RelayState));
					}
					await onSsoCallbackError?.({
						error: responseSettled.error,
						organizationId
					});

					return status(
						'Internal Server Error',
						'SAML logout failed'
					);
				}

				if (!isNonEmptyString(SAMLRequest)) {
					return status(
						'Bad Request',
						'Missing SAMLRequest or SAMLResponse'
					);
				}
				const validateRequest = samlAdapter.validateLogoutRequest;
				if (validateRequest === undefined) {
					return status(
						'Not Implemented',
						'SAML Single Logout is not configured'
					);
				}

				const requestSettled = await settle(
					validateRequest({
						connection,
						relayState: RelayState,
						samlRequest: SAMLRequest,
						signature: Signature,
						signatureAlgorithm: SigAlg,
						signedQueryString,
						sloUrl
					})
				);
				if ('error' in requestSettled) {
					await onSsoCallbackError?.({
						error: requestSettled.error,
						organizationId
					});

					return status('Bad Request', 'Invalid SAML LogoutRequest');
				}

				await clearSession({
					authSessionStore,
					cookie: user_session_id,
					inMemorySession: session
				});

				const info = requestSettled.value;
				const buildLogoutResponse = samlAdapter.createLogoutResponseUrl;
				if (buildLogoutResponse !== undefined) {
					const url = await buildLogoutResponse({
						connection,
						inResponseTo: info.requestId,
						nameId: info.nameId,
						relayState: info.relayState ?? RelayState,
						sloUrl
					});

					return redirect(url);
				}

				return redirect(toLocalPath(info.relayState ?? RelayState));
			},
			{
				cookie: t.Cookie({
					user_session_id: t.Optional(userSessionIdTypebox)
				}),
				params: t.Object({ organizationId: t.String() }),
				query: t.Object({
					RelayState: t.Optional(t.String()),
					SAMLRequest: t.Optional(t.String()),
					SAMLResponse: t.Optional(t.String()),
					SigAlg: t.Optional(t.String()),
					Signature: t.Optional(t.String())
				})
			}
		);
};
