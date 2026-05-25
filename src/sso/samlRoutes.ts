import { Elysia, t } from 'elysia';
import { clearSession, promoteToSession } from '../session/promote';
import { sessionStore } from '../session/state';
import type { AuthSessionStore } from '../session/types';
import { userSessionIdTypebox } from '../typebox';
import type { RouteString } from '../types';
import {
	DEFAULT_SSO_ROUTE,
	DEFAULT_SSO_SESSION_TTL_MS,
	type SamlAdapter,
	type SsoIdentity,
	type SSOConfig
} from './config';

type SamlRoutesProps<UserType> = SSOConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
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

export const samlSsoRoutes = <UserType>({
	authSessionStore,
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

	const acsUrlFor = (requestUrl: string, organizationId: string) =>
		`${new URL(requestUrl).origin}${ssoRoute}/saml/${organizationId}/acs`;

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
						inMemorySession: session,
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
					connection
				});

				return new Response(metadata, {
					headers: { 'content-type': 'application/xml' }
				});
			},
			{ params: t.Object({ organizationId: t.String() }) }
		)
		.get(
			logoutRoute,
			// Single Logout: always clear the local session, then bounce to the IdP's SLO
			// endpoint (if the connection declares one) so the IdP can end its own session.
			async ({
				cookie: { user_session_id },
				params: { organizationId },
				redirect,
				store: { session }
			}) => {
				const connection =
					await ssoConnectionStore.getConnectionByOrganization(
						organizationId,
						'saml'
					);
				await clearSession({
					authSessionStore,
					cookie: user_session_id,
					inMemorySession: session
				});
				const idpSloUrl =
					connection?.type === 'saml'
						? connection.config.idpSloUrl
						: undefined;

				return redirect(idpSloUrl ?? '/');
			},
			{
				cookie: t.Cookie({
					user_session_id: t.Optional(userSessionIdTypebox)
				}),
				params: t.Object({ organizationId: t.String() })
			}
		);
};
