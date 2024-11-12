import Elysia from 'elysia';
import { generateState, generateCodeVerifier } from 'arctic';
import type { ClientProviders, OAuthEventHandler } from './types';
import { isValidProviderKey } from './typeGuards';

type AuthorizeProps = {
	clientProviders: ClientProviders;
	authorizeRoute?: string;
	onAuthorize?: OAuthEventHandler;
};

export const authorize = ({
	clientProviders,
	authorizeRoute = 'authorize',
	onAuthorize
}: AuthorizeProps) => {
	return new Elysia().get(
		`/${authorizeRoute}/:provider`,
		({
			error,
			redirect,
			cookie: { state, code_verifier, auth_provider, redirect_url },
			params: { provider },
			headers
		}) => {
			if (provider === undefined)
				return error(400, 'Provider is required');

			if (!isValidProviderKey(provider)) {
				return error(400, 'Invalid provider');
			}

			try {
				const normalizedProvider = provider.toLowerCase();
				const { providerInstance, scopes, searchParams } =
					clientProviders[normalizedProvider];

				const redirectUrl = headers['referer'] || '/';

				redirect_url.set({
					value: redirectUrl,
					secure: true,
					sameSite: 'lax',
					path: '/',
					httpOnly: true,
					maxAge: 60 * 10
				});

				auth_provider.set({
					value: provider,
					secure: true,
					sameSite: 'lax',
					path: '/',
					httpOnly: true,
					maxAge: 60 * 10
				});

				const currentState = generateState();

				state.set({
					value: currentState,
					secure: true,
					sameSite: 'lax',
					path: '/',
					httpOnly: true,
					maxAge: 60 * 10
				});

				let authorizationURL: URL;
				let current_code_verifier;

				//TODO figure out how to handle code verifier
				if (
					providerInstance.createAuthorizationURL
						.toString()
						.includes('codeVerifier')
				) {
					current_code_verifier = generateCodeVerifier();
					code_verifier.set({
						value: current_code_verifier,
						secure: true,
						sameSite: 'lax',
						path: '/',
						httpOnly: true,
						maxAge: 60 * 10
					});

					authorizationURL = providerInstance.createAuthorizationURL(
						currentState,
						// @ts-expect-error - This is a dynamic check
						current_code_verifier,
						scopes
					);
				} else {
					authorizationURL =
						// @ts-expect-error - This is a dynamic check
						providerInstance.createAuthorizationURL(
							currentState,
							scopes
						);
				}

				searchParams.forEach(([key, value]) => {
					authorizationURL.searchParams.set(key, value);
				});

				onAuthorize?.();

				return redirect(authorizationURL.toString());
			} catch (err) {
				if (err instanceof Error) {
					console.error(
						'Failed to validate authorization code:',
						err.message
					);
				}

				return error(500);
			}
		}
	);
};
