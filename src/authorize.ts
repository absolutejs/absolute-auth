import { Elysia } from 'elysia';
import { COOKIE_DURATION } from './constants';
import { ClientProviders } from './types';
import {
	generateCodeVerifier,
	generateState,
	isPKCEProviderOption,
	isValidProviderOption
} from 'citra';

type AuthorizeProps = {
	clientProviders: ClientProviders;
	authorizeRoute?: `${string}/:provider${'' | `/${string}`}`;
	onAuthorize?: () => void;
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
			cookie: { state, code_verifier, auth_provider, redirect_url },
			params: { provider },
			headers
		}) => {
			if (provider === undefined)
				return error('Bad Request', 'Provider is required');

			if (!isValidProviderOption(provider)) {
				return error('Bad Request', 'Invalid provider');
			}

			try {
				const normalizedProvider = provider.toLowerCase();
				const { providerInstance, scope, searchParams } =
					clientProviders[normalizedProvider];

				const redirectUrl = headers['referer'] ?? '/';

				redirect_url.set({
					httpOnly: true,
					maxAge: COOKIE_DURATION,
					path: '/',
					sameSite: 'lax',
					secure: true,
					value: redirectUrl
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

				let authorizationURL;

				if (isPKCEProviderOption(provider)) {
					const codeVerifier = generateCodeVerifier();

					code_verifier.set({
						httpOnly: true,
						maxAge: COOKIE_DURATION,
						path: '/',
						sameSite: 'lax',
						secure: true,
						value: codeVerifier ?? ''
					});

					authorizationURL =
						await providerInstance.createAuthorizationUrl({
							state: currentState,
							codeVerifier,
							scope
						});
				} else {
					authorizationURL =
						await providerInstance.createAuthorizationUrl({
							state: currentState,
							scope
						});
				}

				searchParams?.forEach(([key, value]) => {
					authorizationURL.searchParams.set(key, value);
				});

				onAuthorize?.();

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
