import { isPKCEProviderOption } from 'citra';
import { Elysia, t } from 'elysia';
import { sessionStore } from './sessionStore';
import { isNonEmptyString } from './typeGuards';
import { authProviderOption, userSessionIdCookie } from './typebox';
import {
	ClientProviders,
	OnCallbackError,
	OnCallbackSuccess,
	RouteString
} from './types';
import { getUserSessionId } from './utils';

type CallbackProps<UserType> = {
	clientProviders: ClientProviders;
	callbackRoute?: RouteString;
	onCallbackSuccess: OnCallbackSuccess<UserType>;
	onCallbackError: OnCallbackError;
};

export const callback = <UserType>({
	clientProviders,
	callbackRoute = '/oauth2/callback',
	onCallbackSuccess,
	onCallbackError
}: CallbackProps<UserType>) =>
	new Elysia().use(sessionStore<UserType>()).get(
		callbackRoute,
		async ({
			status,
			redirect,
			store: { session, unregisteredSession },
			cookie,
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
				user_session_id === undefined
			) {
				return status('Bad Request', 'Cookies are missing');
			}

			if (!isNonEmptyString(code) || stored_state.value === undefined) {
				return status('Bad Request', 'Invalid callback request');
			}

			if (callback_state !== stored_state.value) {
				return status('Bad Request', 'Invalid state mismatch');
			}

			const providerConfig = clientProviders[auth_provider.value];
			if (!providerConfig) {
				return status('Unauthorized', 'Client provider not found');
			}
			const { providerInstance } = providerConfig;

			stored_state.remove();

			const authProvider = auth_provider.value;
			const requiresPKCE = isPKCEProviderOption(authProvider);
			const verifier = requiresPKCE ? code_verifier.value : undefined;
			if (requiresPKCE && verifier === undefined) {
				return status(
					'Bad Request',
					'Code verifier not found and is required'
				);
			}

			const originUrl = origin_url?.value ?? '/';

			let tokenResponse;
			try {
				tokenResponse =
					await providerInstance.validateAuthorizationCode(
						requiresPKCE
							? { code, codeVerifier: verifier }
							: { code }
					);
			} catch (err) {
				await onCallbackError?.({
					authProvider,
					error: err,
					originUrl
				});

				return err instanceof Error
					? status(
							'Internal Server Error',
							`${err.message} - ${err.stack ?? ''}`
						)
					: status(
							'Internal Server Error',
							`Failed to validate authorization code: Unknown status: ${err}`
						);
			}

			const userSessionId = getUserSessionId(user_session_id);

			const response = await onCallbackSuccess?.({
				authProvider,
				cookie,
				originUrl,
				providerInstance,
				redirect,
				session,
				status,
				tokenResponse,
				unregisteredSession,
				userSessionId
			});

			if (response) {
				return response;
			}

			return redirect(originUrl);
		},
		{
			cookie: t.Cookie({
				auth_provider: authProviderOption,
				user_session_id: userSessionIdCookie
			})
		}
	);
