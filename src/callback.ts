import { isPKCEProviderOption } from 'citra';
import { Elysia, t } from 'elysia';
import { AuthIdentityConflictError } from './errors';
import { resolveClientProviderEntry } from './providerClients';
import { createSessionCompatibilityLayer } from './sessionAccess';
import { sessionStore } from './sessionStore';
import type { AuthSessionStore } from './sessionTypes';
import { isAuthIntent, isNonEmptyString } from './typeGuards';
import {
	authClientOption,
	authIntentOption,
	authProviderOption,
	userSessionIdTypebox
} from './typebox';
import {
	ClientProviders,
	OnCallbackError,
	OnCallbackSuccess,
	OnLinkConnector,
	OnLinkIdentity,
	OnLinkIdentityConflict,
	ResolveAuthIntent,
	RouteString
} from './types';

type CallbackProps<UserType> = {
	authSessionStore?: AuthSessionStore<UserType>;
	clientProviders: ClientProviders;
	callbackRoute?: RouteString;
	resolveAuthIntent?: ResolveAuthIntent<UserType>;
	onCallbackSuccess: OnCallbackSuccess<UserType>;
	onLinkIdentity?: OnLinkIdentity<UserType>;
	onLinkIdentityConflict?: OnLinkIdentityConflict<UserType>;
	onLinkConnector?: OnLinkConnector<UserType>;
	onCallbackError: OnCallbackError;
};

export const callback = <UserType>({
	authSessionStore,
	clientProviders,
	callbackRoute = '/oauth2/callback',
	resolveAuthIntent,
	onCallbackSuccess,
	onLinkIdentity,
	onLinkIdentityConflict,
	onLinkConnector,
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
				auth_provider,
				auth_client,
				auth_intent
			},
			query: { code, state: callback_state }
		}) => {
			if (
				stored_state === undefined ||
				code_verifier === undefined ||
				user_session_id === undefined ||
				auth_client === undefined ||
				auth_intent === undefined
			) {
				return status('Bad Request', 'Cookies are missing');
			}

			if (!isNonEmptyString(code) || stored_state.value === undefined) {
				return status('Bad Request', 'Invalid callback request');
			}

			if (callback_state !== stored_state.value) {
				return status('Bad Request', 'Invalid state mismatch');
			}

			const resolvedProvider = resolveClientProviderEntry({
				clientName: auth_client.value || undefined,
				clientProviders,
				providerName: auth_provider.value
			});
			if ('error' in resolvedProvider) {
				return status('Unauthorized', resolvedProvider.error);
			}
			const { clientName, providerInstance } = resolvedProvider.entry;

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
				console.error(
					'[callback] Failed to validate authorization code:',
					{
						authClient: clientName,
						authProvider,
						error: err instanceof Error ? err.message : err,
						stack: err instanceof Error ? err.stack : undefined
					}
				);

				await onCallbackError?.({
					authClient: clientName,
					authProvider,
					error: err,
					originUrl
				});

				return status(
					'Internal Server Error',
					'Failed to validate authorization code'
				);
			}

			const compatibilityLayer = await createSessionCompatibilityLayer({
				authSessionStore,
				userSessionId: user_session_id.value
			});
			const callbackSession = authSessionStore
				? compatibilityLayer.session
				: session;
			const callbackUnregisteredSession = authSessionStore
				? compatibilityLayer.unregisteredSession
				: unregisteredSession;
			const currentUser =
				user_session_id.value !== undefined
					? callbackSession[user_session_id.value]?.user
					: undefined;
			const authIntent =
				(isAuthIntent(auth_intent.value)
					? auth_intent.value
					: undefined) ??
				(await resolveAuthIntent?.({
					authClient: clientName,
					authProvider,
					currentUser,
					originUrl,
					session: callbackSession,
					userSessionId: user_session_id.value
				})) ??
				'login';
			auth_intent.remove();

			const userSessionId = user_session_id.value ?? crypto.randomUUID();
			const callbackContext = {
				authClient: clientName,
				authIntent,
				authProvider,
				cookie,
				currentUser,
				originUrl,
				providerInstance,
				redirect,
				session: callbackSession,
				status,
				tokenResponse,
				unregisteredSession: callbackUnregisteredSession,
				userSessionId
			} as const;

			let response;
			try {
				response =
					authIntent === 'link_identity' && onLinkIdentity
						? await onLinkIdentity(callbackContext)
						: authIntent === 'link_connector' && onLinkConnector
							? await onLinkConnector(callbackContext)
							: await onCallbackSuccess?.(callbackContext);
			} catch (err) {
				if (
					authIntent === 'link_identity' &&
					err instanceof AuthIdentityConflictError &&
					onLinkIdentityConflict
				) {
					response = await onLinkIdentityConflict({
						...callbackContext,
						conflict: {
							...err.conflict,
							intent: authIntent
						}
					});
				} else {
					throw err;
				}
			}

			if (authSessionStore) {
				await compatibilityLayer.persist();
			}

			if (response) {
				return response;
			}

			return redirect(originUrl);
		},
		{
			cookie: t.Cookie({
				auth_client: authClientOption,
				auth_intent: authIntentOption,
				auth_provider: authProviderOption,
				code_verifier: t.Optional(t.String()),
				origin_url: t.Optional(t.String()),
				state: t.Optional(t.String()),
				user_session_id: userSessionIdTypebox
			})
		}
	);
