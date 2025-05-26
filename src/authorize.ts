import {
	generateCodeVerifier,
	generateState,
	isPKCEProviderOption,
	isValidProviderOption
} from 'citra';
import { Elysia } from 'elysia';
import { COOKIE_DURATION } from './constants';
import { AuthorizeRoute, ClientProviders, OnAuthorize } from './types';

type AuthorizeProps = {
	clientProviders: ClientProviders;
	authorizeRoute?: AuthorizeRoute;
	onAuthorize?: OnAuthorize;
};

export const authorize = ({
	clientProviders,
	authorizeRoute = '/oauth2/:provider/authorization',
	onAuthorize
}: AuthorizeProps) =>
	new Elysia().get(
		authorizeRoute,
		async ({
			error,
			redirect,
			cookie: { state, code_verifier, auth_provider, origin_url },
			params: { provider },
			headers
		}) => {
			if (
				auth_provider === undefined ||
				origin_url === undefined ||
				state === undefined ||
				code_verifier === undefined
			)
				return error('Bad Request', 'Cookies are missing');

			if (provider === undefined)
				return error('Bad Request', 'Provider is required');

			if (!isValidProviderOption(provider))
				return error('Bad Request', 'Invalid provider');

			const providerConfig = clientProviders[provider];
			if (!providerConfig)
				return error('Unauthorized', 'Client provider not found');

			const { providerInstance, scope, searchParams } = providerConfig;
			const normalizedProvider = provider.toLowerCase();
			const referer = headers['referer'] ?? '/';

			origin_url.set({
				httpOnly: true,
				maxAge: COOKIE_DURATION,
				path: '/',
				sameSite: 'lax',
				secure: true,
				value: referer
			});

			auth_provider.set({
				httpOnly: true,
				maxAge: COOKIE_DURATION,
				path: '/',
				sameSite: 'lax',
				secure: true,
				value: normalizedProvider
			});

			const currentState = generateState();
			state.set({
				httpOnly: true,
				maxAge: COOKIE_DURATION,
				path: '/',
				sameSite: 'lax',
				secure: true,
				value: currentState
			});

			const codeVerifier = isPKCEProviderOption(provider)
				? generateCodeVerifier()
				: undefined;

			if (codeVerifier) {
				code_verifier.set({
					httpOnly: true,
					maxAge: COOKIE_DURATION,
					path: '/',
					sameSite: 'lax',
					secure: true,
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

				onAuthorize?.({
					authorizationUrl: authorizationURL,
					authProvider: normalizedProvider
				});

				return redirect(authorizationURL.toString());
			} catch (err) {
				if (err instanceof Error) {
					return error(
						'Internal Server Error',
						`${err.message} - ${err.stack ?? ''}`
					);
				}

				return error('Internal Server Error', `Unknown error: ${err}`);
			}
		}
	);
