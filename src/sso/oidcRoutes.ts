import { createOIDCClient, generateCodeVerifier, generateState } from 'citra';
import { Elysia, t } from 'elysia';
import { COOKIE_DURATION } from '../constants';
import { promoteToSession } from '../session/promote';
import { sessionStore } from '../session/state';
import type { AuthSessionStore } from '../session/types';
import { isNonEmptyString } from '../typeGuards';
import { userSessionIdTypebox } from '../typebox';
import type { RouteString } from '../types';
import { resolveCookieSecure } from '../utils';
import {
	DEFAULT_SSO_ROUTE,
	DEFAULT_SSO_SESSION_TTL_MS,
	type SsoIdentity,
	type SSOConfig
} from './config';

type OidcRoutesProps<UserType> = SSOConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
	cookieSecure?: boolean;
};

type SsoCookieOptions = {
	httpOnly: boolean;
	maxAge: number;
	path: string;
	sameSite: 'lax';
	secure: boolean;
};

const makeSsoCookieOptions = (secure: boolean): SsoCookieOptions => ({
	httpOnly: true,
	maxAge: COOKIE_DURATION,
	path: '/',
	sameSite: 'lax',
	secure
});

const ssoCookieSchema = t.Cookie({
	sso_nonce: t.Optional(t.String()),
	sso_organization: t.Optional(t.String()),
	sso_origin: t.Optional(t.String()),
	sso_state: t.Optional(t.String()),
	sso_verifier: t.Optional(t.String()),
	user_session_id: t.Optional(userSessionIdTypebox)
});

const parseReferer = (referer: string | undefined) => {
	if (referer === undefined) return '/';

	try {
		const url = new URL(referer);

		return url.pathname + url.search;
	} catch {
		return referer.startsWith('/') && !referer.startsWith('//')
			? referer
			: '/';
	}
};

export const oidcSsoRoutes = <UserType>({
	authSessionStore,
	cookieSecure,
	getSsoUser,
	onSsoCallbackError,
	onSsoCallbackSuccess,
	sessionDurationMs = DEFAULT_SSO_SESSION_TTL_MS,
	ssoConnectionStore,
	ssoRoute = DEFAULT_SSO_ROUTE
}: OidcRoutesProps<UserType>) => {
	const ssoCookieOptions = makeSsoCookieOptions(
		resolveCookieSecure(cookieSecure)
	);
	const authorizeRoute: RouteString = `${ssoRoute}/oidc/:organizationId/authorize`;
	const callbackRoute: RouteString = `${ssoRoute}/oidc/:organizationId/callback`;

	return new Elysia()
		.use(sessionStore<UserType>())
		.get(
			authorizeRoute,
			async ({
				cookie: {
					sso_nonce,
					sso_organization,
					sso_origin,
					sso_state,
					sso_verifier
				},
				headers,
				params: { organizationId },
				redirect,
				status
			}) => {
				const connection =
					await ssoConnectionStore.getConnectionByOrganization(
						organizationId,
						'oidc'
					);
				if (connection === undefined || connection.type !== 'oidc') {
					return status(
						'Not Found',
						'No OIDC connection is configured for this organization'
					);
				}

				const client = await createOIDCClient(connection.config);
				const state = generateState();
				const codeVerifier = generateCodeVerifier();
				const nonce = generateState();

				sso_state.set({ ...ssoCookieOptions, value: state });
				sso_verifier.set({ ...ssoCookieOptions, value: codeVerifier });
				sso_nonce.set({ ...ssoCookieOptions, value: nonce });
				sso_organization.set({
					...ssoCookieOptions,
					value: organizationId
				});
				sso_origin.set({
					...ssoCookieOptions,
					value: parseReferer(headers['referer'])
				});

				const authorizationUrl = await client.createAuthorizationUrl({
					codeVerifier,
					nonce,
					state
				});

				return redirect(authorizationUrl.toString());
			},
			{
				cookie: ssoCookieSchema,
				params: t.Object({ organizationId: t.String() })
			}
		)
		.get(
			callbackRoute,
			async ({
				cookie: {
					sso_nonce,
					sso_organization,
					sso_origin,
					sso_state,
					sso_verifier,
					user_session_id
				},
				params: { organizationId },
				query: { code, state },
				redirect,
				status,
				store: { session }
			}) => {
				if (
					sso_state.value === undefined ||
					sso_verifier.value === undefined ||
					sso_organization.value === undefined
				) {
					return status(
						'Bad Request',
						'SSO session cookies are missing'
					);
				}
				if (!isNonEmptyString(code) || state !== sso_state.value) {
					return status(
						'Bad Request',
						'Invalid SSO callback request'
					);
				}
				if (sso_organization.value !== organizationId) {
					return status('Bad Request', 'SSO organization mismatch');
				}

				const connection =
					await ssoConnectionStore.getConnectionByOrganization(
						organizationId,
						'oidc'
					);
				if (connection === undefined || connection.type !== 'oidc') {
					return status(
						'Not Found',
						'No OIDC connection is configured for this organization'
					);
				}

				const codeVerifier = sso_verifier.value;
				const nonce = sso_nonce.value;
				const originUrl = sso_origin.value ?? '/';
				sso_state.remove();
				sso_verifier.remove();
				sso_nonce.remove();
				sso_organization.remove();
				sso_origin.remove();

				try {
					const client = await createOIDCClient(connection.config);
					const tokenResponse =
						await client.validateAuthorizationCode({
							code,
							codeVerifier
						});
					if (!isNonEmptyString(tokenResponse.id_token)) {
						return status(
							'Bad Request',
							'OIDC token response is missing an id_token'
						);
					}

					const claims = await client.verifyIdToken(
						tokenResponse.id_token,
						{ nonce }
					);
					const identity: SsoIdentity = {
						claims,
						connection,
						email:
							typeof claims.email === 'string'
								? claims.email
								: undefined,
						organizationId,
						protocol: 'oidc',
						sub: claims.sub,
						tokenResponse
					};

					const user = await getSsoUser(identity);
					const userSessionId = await promoteToSession({
						authSessionStore,
						cookie: user_session_id,
						cookieSecure,
						inMemorySession: session,
						sessionDurationMs,
						user
					});
					await onSsoCallbackSuccess?.({
						identity,
						user,
						userSessionId
					});

					return redirect(originUrl);
				} catch (error) {
					await onSsoCallbackError?.({ error, organizationId });

					return status(
						'Internal Server Error',
						'OIDC sign-in failed'
					);
				}
			},
			{
				cookie: ssoCookieSchema,
				params: t.Object({ organizationId: t.String() }),
				query: t.Object({
					code: t.Optional(t.String()),
					state: t.Optional(t.String())
				})
			}
		);
};
