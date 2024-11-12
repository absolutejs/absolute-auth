import Elysia from 'elysia';
import type {
	ClientProviders,
	CreateUser,
	GetUser,
	OAuthEventHandler
} from './types';
import { sessionStore } from './sessionStore';
import { decodeIdToken } from 'arctic';
import { isValidProviderKey, isValidUser } from './typeGuards';

type CallbackProps<UserType> = {
	clientProviders: ClientProviders;
	callbackRoute?: string;
	onCallback?: OAuthEventHandler;
	getUser?: GetUser<UserType>;
	createUser?: CreateUser<UserType>;
};

export const callback = <UserType>({
	clientProviders,
	callbackRoute = 'authorize/callback',
	onCallback,
	getUser,
	createUser
}: CallbackProps<UserType>) => {
	return new Elysia()
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
				if (!code || !stored_state.value) {
					return error(400, 'Invalid callback request');
				}

				if (callback_state !== stored_state.value) {
					return error(400, 'Invalid state mismatch');
				}

				if (auth_provider.value === undefined) {
					return error(401, 'No auth provider found');
				}

				if (!isValidProviderKey(auth_provider.value)) {
					return error(400, 'Invalid provider');
				}

				const normalizedProvider = auth_provider.value.toLowerCase();
				const { providerInstance } =
					clientProviders[normalizedProvider];

				try {
					let tokens;

					// Clear the stored state so the next request doesn't use it
					stored_state.remove();

					if (
						providerInstance.validateAuthorizationCode
							.toString()
							.includes('codeVerifier')
					) {
						if (!code_verifier.value) {
							return error(
								400,
								'Code verifier not found and is required'
							);
						}

						tokens =
							await providerInstance.validateAuthorizationCode(
								code,
								code_verifier.value
							);

						// Clear the code verifier after use
						code_verifier.remove();
					} else {
						tokens =
							// @ts-expect-error - This is a dynamic check
							await providerInstance.validateAuthorizationCode(
								code
							);
					}

					// Add the user to the session
					const decodedIdToken = decodeIdToken(tokens.idToken()) as {
						[key: string]: string | undefined;
					};

					const authProvider = auth_provider.value;
					let user = await getUser?.({
						decodedIdToken,
						authProvider
					});

					if (user === null || user === undefined) {
						user = await createUser?.({
							decodedIdToken,
							authProvider
						});
					}

					const sessionKey = crypto.randomUUID();

					if (!isValidUser<UserType>(user)) {
						return error(500, 'Invalid user schema');
					}

					session[sessionKey] = {
						user,
						expiresAt: Date.now() + 1000 * 60 * 60 * 24
					};

					user_session_id.set({
						value: sessionKey,
						secure: true,
						httpOnly: true,
						sameSite: 'lax'
					});

					onCallback?.();

					// Bring the user back to where they were or the home page
					const redirectUrl = redirect_url.value ?? '/';

					return redirect(redirectUrl);
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
