import { generateState, generateCodeVerifier } from 'arctic';
import { Elysia } from 'elysia';
import { isValidProviderKey } from './typeGuards';
import { ClientProviders, OAuthEventHandler } from './types';
import { COOKIE_DURATION } from './constants';

type AuthorizeProps = {
	clientProviders: ClientProviders;
	authorizeRoute?: string;
	onAuthorize?: OAuthEventHandler;
};

export const authorize = ({
	clientProviders,
	authorizeRoute = 'authorize',
	onAuthorize
}: AuthorizeProps) =>
	new Elysia().get(
		`/${authorizeRoute}/:provider`,
		({
			error,
			redirect,
			cookie: { state, code_verifier, auth_provider, redirect_url },
			params: { provider },
			headers
		}) => {
			if (provider === undefined)
				return error('Bad Request', 'Provider is required');

			if (!isValidProviderKey(provider)) {
				return error('Bad Request', 'Invalid provider');
			}

			try {
				const normalizedProvider = provider.toLowerCase();
				const { providerInstance, scopes, searchParams } =
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
					value: provider
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

				const usesCodeVerifier = providerInstance.createAuthorizationURL
					.toString()
					.includes('codeVerifier');
				const verifier = usesCodeVerifier
					? generateCodeVerifier()
					: undefined;
				void (
					usesCodeVerifier &&
					code_verifier.set({
						httpOnly: true,
						maxAge: COOKIE_DURATION,
						path: '/',
						sameSite: 'lax',
						secure: true,
						value: verifier ?? ''
					})
				);

				const authorizationURL = usesCodeVerifier
					? providerInstance.createAuthorizationURL(
							currentState,
							// @ts-expect-error - This is a dynamic check
							verifier,
							scopes
						)
					: // @ts-expect-error - This is a dynamic check
						providerInstance.createAuthorizationURL(
							currentState,
							scopes
						);

				searchParams.forEach(([key, value]) => {
					authorizationURL.searchParams.set(key, value);
				});

				onAuthorize?.();

				return redirect(authorizationURL.toString());
			} catch (err) {
				if (err instanceof Error) {
					return error(
						'Internal Server Error',
						`Failed to authorize: ${err.message}`
					);
				}

				return error('Internal Server Error', `Unknown error: ${err}`);
			}
		}
	);
