import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import { isNonEmptyString } from './typeGuards';
import { ClientProviders, OnCallback } from './types';
import {
	decodeJWT,
	isPKCEProviderOption,
	isValidProviderOption,
	OAuth2TokenResponse
} from 'citra';

type CallbackProps<UserType> = {
	clientProviders: ClientProviders;
	callbackRoute?: string;
	onCallback?: OnCallback<UserType>;
};

export const callback = <UserType>({
	clientProviders,
	callbackRoute = 'authorize/callback',
	onCallback
}: CallbackProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.get(
			`/${callbackRoute}`,
			async ({
				error,
				redirect,
				store: { session },
				cookie: {
					state: stored_state,
					code_verifier,
					redirect_url,
					user_session_id,
					auth_provider
				},
				query: { code, state: callback_state }
			}) => {
				if (
					!isNonEmptyString(code) ||
					stored_state.value === undefined
				) {
					return error('Bad Request', 'Invalid callback request');
				}

				if (callback_state !== stored_state.value) {
					return error('Bad Request', 'Invalid state mismatch');
				}

				if (auth_provider.value === undefined) {
					return error('Unauthorized', 'No auth provider found');
				}

				if (!isValidProviderOption(auth_provider.value)) {
					return error('Unauthorized', 'Invalid provider');
				}

				const { providerInstance } =
					clientProviders[auth_provider.value];

				try {
					// Clear the stored state so the next request doesn't use it
					stored_state.remove();

					const authProvider = auth_provider.value;
					let tokens: OAuth2TokenResponse;
					if (isPKCEProviderOption(authProvider)) {
						const verifier = code_verifier.value;
						if (verifier === undefined)
							return error(
								'Bad Request',
								'Code verifier not found and is required'
							);
						tokens =
							await providerInstance.validateAuthorizationCode({
								code,
								codeVerifier: verifier
							});
					} else {
						tokens =
							await providerInstance.validateAuthorizationCode({
								code
							});
					}

					console.log(authProvider, tokens);

					await onCallback?.({
						authProvider,
						session,
						user_session_id,
						userProfile: decodeJWT(
							tokens.id_token ? tokens.id_token : ''
						)
					});

					const redirectUrl = redirect_url.value ?? '/';

					return redirect(redirectUrl);
				} catch (err) {
					if (err instanceof Error)
						return error(
							'Internal Server Error',
							`${err.message} - ${err.stack ?? ''}`
						);

					return error(
						'Internal Server Error',
						`Failed to validate authorization code: Unknown error: ${err}`
					);
				}
			}
		);
