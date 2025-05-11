import { decodeIdToken } from 'arctic';
import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import { isNonEmptyString } from './typeGuards';
import { ClientProviders, OnCallback } from './types';
import { isValidProviderOption } from 'citra';

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

				const normalizedProvider = auth_provider.value.toLowerCase();
				const { providerInstance } =
					clientProviders[normalizedProvider];

				try {
					// Clear the stored state so the next request doesn't use it
					stored_state.remove();

					const hasCodeVerifier =
						providerInstance.validateAuthorizationCode
							.toString()
							.includes('codeVerifier');
					const verifier = code_verifier.value;
					if (hasCodeVerifier && verifier === undefined)
						return error(
							'Bad Request',
							'Code verifier not found and is required'
						);

					const safeVerifier = verifier ?? '';
					const tokens = await (hasCodeVerifier
						? providerInstance.validateAuthorizationCode({
								code,
								codeVerifier: safeVerifier
							})
						: // @ts-expect-error - This is a dynamic check
							providerInstance.validateAuthorizationCode(code));

					if (hasCodeVerifier) code_verifier.remove();

					let userProfile;
					const authProvider = auth_provider.value;

					// TODO : Change if arctic ever updates
					try {
						const decodedIdToken = Object.fromEntries(
							Object.entries(decodeIdToken(tokens.idToken())).map(
								([key, value]) => [
									key,
									typeof value === 'string'
										? value
										: undefined
								]
							)
						);
						userProfile = decodedIdToken;
					} catch (err) {
						// TODO : This has type any see if it can be fixed
						userProfile = await providerInstance.fetchUserProfile({
							authProvider,
							accessToken: tokens.accessToken()
						});
					}

					await onCallback?.({
						authProvider,
						session,
						user_session_id,
						userProfile
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
