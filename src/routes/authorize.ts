import { generateCodeVerifier, generateState } from 'citra';
import { Elysia, t } from 'elysia';
import { COOKIE_DURATION } from '../constants';
import { resolveClientProviderEntry } from '../providers/clients';
import { isAuthIntent } from '../typeGuards';
import {
	authClientOption,
	authIntentOption,
	authProviderOption
} from '../typebox';
import {
	AuthorizeRoute,
	ClientProviders,
	OnAuthorizeError,
	OnAuthorizeSuccess
} from '../types';
import { resolveCookieSecure } from '../utils';

type AuthorizeProps = {
	clientProviders: ClientProviders;
	authorizeRoute?: AuthorizeRoute;
	cookieSecure?: boolean;
	onAuthorizeSuccess: OnAuthorizeSuccess;
	onAuthorizeError: OnAuthorizeError;
};

const parseReferer = (headerReferer: string | undefined) => {
	if (!headerReferer) return '/';

	try {
		const url = new URL(headerReferer);

		return url.pathname + url.search;
	} catch {
		if (headerReferer.startsWith('/') && !headerReferer.startsWith('//')) {
			return headerReferer;
		}

		return '/';
	}
};

export const authorize = ({
	clientProviders,
	authorizeRoute = '/oauth2/:provider/authorization',
	cookieSecure,
	onAuthorizeSuccess,
	onAuthorizeError
}: AuthorizeProps) => {
	const secure = resolveCookieSecure(cookieSecure);

	return new Elysia().get(
		authorizeRoute,
		async ({
			status,
			redirect,
			cookie: {
				state,
				code_verifier,
				auth_provider,
				auth_client,
				auth_intent,
				origin_url
			},
			params: { provider },
			query: { client, intent },
			headers
		}) => {
			if (
				auth_provider === undefined ||
				auth_client === undefined ||
				auth_intent === undefined ||
				origin_url === undefined ||
				state === undefined ||
				code_verifier === undefined
			)
				return status('Bad Request', 'Cookies are missing');

			if (provider === undefined)
				return status('Bad Request', 'Provider is required');

			const resolvedProvider = resolveClientProviderEntry({
				clientName: client,
				clientProviders,
				providerName: provider
			});
			if ('error' in resolvedProvider) {
				return status('Unauthorized', resolvedProvider.error);
			}

			const {
				clientName,
				providerInstance,
				requiresPKCE,
				scope,
				searchParams
			} = resolvedProvider.entry;
			const referer = parseReferer(headers['referer']);
			const authIntent = isAuthIntent(intent) ? intent : undefined;

			origin_url.set({
				httpOnly: true,
				maxAge: COOKIE_DURATION,
				path: '/',
				sameSite: 'lax',
				secure,
				value: referer
			});

			auth_provider.set({
				httpOnly: true,
				maxAge: COOKIE_DURATION,
				path: '/',
				sameSite: 'lax',
				secure,
				value: provider
			});

			auth_client.set({
				httpOnly: true,
				maxAge: COOKIE_DURATION,
				path: '/',
				sameSite: 'lax',
				secure,
				value: clientName ?? ''
			});

			if (authIntent !== undefined) {
				auth_intent.set({
					httpOnly: true,
					maxAge: COOKIE_DURATION,
					path: '/',
					sameSite: 'lax',
					secure,
					value: authIntent
				});
			} else {
				auth_intent.remove();
			}

			const currentState = generateState();
			state.set({
				httpOnly: true,
				maxAge: COOKIE_DURATION,
				path: '/',
				sameSite: 'lax',
				secure,
				value: currentState
			});

			const codeVerifier = requiresPKCE
				? generateCodeVerifier()
				: undefined;

			if (codeVerifier) {
				code_verifier.set({
					httpOnly: true,
					maxAge: COOKIE_DURATION,
					path: '/',
					sameSite: 'lax',
					secure,
					value: codeVerifier
				});
			}

			try {
				const authorizationURL =
					await providerInstance.createAuthorizationUrl(
						codeVerifier
							? { codeVerifier, scope, state: currentState }
							: { scope, state: currentState }
					);

				searchParams?.forEach(([key, value]) =>
					authorizationURL.searchParams.set(key, value)
				);

				await onAuthorizeSuccess?.({
					authClient: clientName,
					authIntent,
					authorizationUrl: authorizationURL,
					authProvider: provider
				});

				return redirect(authorizationURL.toString());
			} catch (err) {
				console.error(
					'[authorize] Failed to create authorization URL:',
					{
						authClient: clientName,
						error: err instanceof Error ? err.message : err,
						provider,
						stack: err instanceof Error ? err.stack : undefined
					}
				);

				await onAuthorizeError?.({
					authClient: clientName,
					authProvider: provider,
					error: err
				});

				return status(
					'Internal Server Error',
					'Failed to create authorization URL'
				);
			}
		},
		{
			cookie: t.Cookie({
				auth_client: authClientOption,
				auth_intent: authIntentOption,
				auth_provider: t.Optional(authProviderOption)
			}),
			params: t.Object({
				provider: authProviderOption
			}),
			query: t.Object({
				client: authClientOption,
				intent: authIntentOption
			})
		}
	);
};
