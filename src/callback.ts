import { isPKCEProviderOption, isValidProviderOption } from 'citra';
import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import { isNonEmptyString } from './typeGuards';
import { ClientProviders, OnCallback, RouteString } from './types';

type CallbackProps<UserType> = {
	clientProviders: ClientProviders;
	callbackRoute?: RouteString;
	onCallback?: OnCallback<UserType>;
};

export const callback = <UserType>({
	clientProviders,
	callbackRoute = '/oauth2/callback',
	onCallback
}: CallbackProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.get(
			callbackRoute,
			async ({
				error,
				redirect,
				store: { session },
				cookie: {
					state: stored_state,
					code_verifier,
					origin_url,
					user_session_id,
					auth_provider
				},
				query: { code, state: callback_state }
			}) => {
				if (
					stored_state === undefined ||
					code_verifier === undefined ||
					auth_provider === undefined ||
					user_session_id === undefined
				) {
					return error('Bad Request', 'Cookies are missing');
				}

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

				const providerConfig = clientProviders[auth_provider.value];
				if (!providerConfig) {
					return error('Unauthorized', 'Client provider not found');
				}
				const { providerInstance } = providerConfig;

				// Clear the stored state so the next request doesn't use it
				stored_state.remove();

				const authProvider = auth_provider.value;
				const requiresPKCE = isPKCEProviderOption(authProvider);
				const verifier = requiresPKCE ? code_verifier.value : undefined;
				if (requiresPKCE && verifier === undefined) {
					return error(
						'Bad Request',
						'Code verifier not found and is required'
					);
				}

				const originUrl = origin_url?.value ?? '/';

				try {
					const tokenResponse =
						await providerInstance.validateAuthorizationCode(
							requiresPKCE
								? { code, codeVerifier: verifier }
								: { code }
						);

					await onCallback?.({
						authProvider,
						originUrl,
						providerInstance,
						session,
						tokenResponse,
						user_session_id
					});

					return redirect(originUrl);
				} catch (err) {
					return err instanceof Error
						? error(
								'Internal Server Error',
								`${err.message} - ${err.stack ?? ''}`
							)
						: error(
								'Internal Server Error',
								`Failed to validate authorization code: Unknown error: ${err}`
							);
				}
			}
		);
