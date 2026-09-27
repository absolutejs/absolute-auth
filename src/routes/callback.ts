import { Elysia, t } from 'elysia';
import { AuthIdentityConflictError } from '../errors';
import { resolveClientProviderEntry } from '../providers/clients';
import { toSafeLocalPath } from '../redirect';
import { createSessionCompatibilityLayer } from '../session/access';
import { sessionStore } from '../session/state';
import type { AuthSessionStore } from '../session/types';
import { withSpan } from '../telemetry/tracing';
import { isAuthIntent, isNonEmptyString } from '../typeGuards';
import {
	authClientOption,
	authIntentOption,
	authProviderOption,
	userSessionIdTypebox
} from '../typebox';
import {
	ClientProviders,
	OnCallbackError,
	OnCallbackSuccess,
	OnLinkConnector,
	OnLinkIdentity,
	OnLinkIdentityConflict,
	ResolveAuthIntent,
	RouteString
} from '../types';

type CallbackProps<UserType> = {
	authSessionStore?: AuthSessionStore<UserType>;
	clientProviders: ClientProviders;
	callbackRoute?: RouteString;
	bindLinkingToSession?: boolean;
	resolveAuthIntent?: ResolveAuthIntent<UserType>;
	onCallbackSuccess: OnCallbackSuccess<UserType>;
	onLinkIdentity?: OnLinkIdentity<UserType>;
	onLinkIdentityConflict?: OnLinkIdentityConflict<UserType>;
	onLinkConnector?: OnLinkConnector<UserType>;
	onCallbackError: OnCallbackError;
};

// Providers that answer with response_mode=form_post (Apple) POST the code here
// from their own site, and browsers don't send SameSite=Lax cookies on that
// cross-site POST, so the state check would fail. Re-issue it as a top-level GET
// to the same route, which does carry them. Only the OAuth response fields pass.
const FORM_POST_FIELDS = [
	'code',
	'state',
	'error',
	'error_description',
	'user'
] as const;
const formPostRelay = (route: RouteString) =>
	new Elysia().post(
		route,
		{
			body: t.Optional(t.Object({}, { additionalProperties: t.String() }))
		},
		({ body, redirect }) => {
			const params = new URLSearchParams();
			for (const field of FORM_POST_FIELDS) {
				const value: unknown = body
					? Reflect.get(body, field)
					: undefined;
				if (typeof value === 'string') params.set(field, value);
			}

			return redirect(`${route}?${params.toString()}`, 303);
		}
	);

export const callback = <UserType>({
	authSessionStore,
	clientProviders,
	callbackRoute = '/oauth2/callback',
	resolveAuthIntent,
	bindLinkingToSession,
	onCallbackSuccess,
	onLinkIdentity,
	onLinkIdentityConflict,
	onLinkConnector,
	onCallbackError
}: CallbackProps<UserType>) =>
	new Elysia()
		.use(formPostRelay(callbackRoute))
		.use(sessionStore<UserType>())
		.get(
			callbackRoute,
			{
				cookie: t.Cookie({
					auth_client: authClientOption,
					auth_intent: authIntentOption,
					auth_link_session: t.Optional(t.String()),
					auth_provider: t.Optional(authProviderOption),
					code_verifier: t.Optional(t.String()),
					origin_url: t.Optional(t.String()),
					state: t.Optional(t.String()),
					user_session_id: t.Optional(userSessionIdTypebox)
				})
			},
			async ({
				status,
				redirect,
				request,
				store: { session, unregisteredSession },
				cookie,
				cookie: {
					state: stored_state,
					code_verifier,
					origin_url,
					user_session_id,
					auth_provider,
					auth_client,
					auth_intent,
					auth_link_session
				},
				query: { code, state: callback_state }
			}) =>
				withSpan(
					'auth.oauth.callback',
					{ 'auth.provider': auth_provider?.value },
					async () => {
						if (
							stored_state === undefined ||
							code_verifier === undefined ||
							auth_provider === undefined ||
							user_session_id === undefined ||
							auth_client === undefined ||
							auth_intent === undefined
						) {
							return status('Bad Request', 'Cookies are missing');
						}
						const authProvider = auth_provider.value;
						if (authProvider === undefined) {
							return status('Bad Request', 'Cookies are missing');
						}

						if (
							!isNonEmptyString(code) ||
							stored_state.value === undefined
						) {
							return status(
								'Bad Request',
								'Invalid callback request'
							);
						}

						if (callback_state !== stored_state.value) {
							return status(
								'Bad Request',
								'Invalid state mismatch'
							);
						}

						const resolvedProvider = resolveClientProviderEntry({
							clientName: auth_client.value || undefined,
							clientProviders,
							providerName: auth_provider.value
						});
						if ('error' in resolvedProvider) {
							return status(
								'Unauthorized',
								resolvedProvider.error
							);
						}
						const {
							clientName,
							providerConfiguration,
							providerInstance,
							requiresPKCE
						} = resolvedProvider.entry;

						stored_state.remove();
						const verifier = requiresPKCE
							? code_verifier.value
							: undefined;
						if (requiresPKCE && verifier === undefined) {
							return status(
								'Bad Request',
								'Code verifier not found and is required'
							);
						}

						// Defense in depth: only ever redirect to a safe same-origin
						// path. This cookie is written from a validated referer today,
						// but validating again here means a future/alternate writer
						// can't turn it into an open redirect.
						const originUrl = toSafeLocalPath(origin_url?.value);

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
									error:
										err instanceof Error
											? err.message
											: err,
									stack:
										err instanceof Error
											? err.stack
											: undefined
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

						const compatibilityLayer =
							await createSessionCompatibilityLayer({
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
						const linking =
							authIntent === 'link_connector' ||
							authIntent === 'link_identity';
						const startedSession = auth_link_session?.value;
						auth_link_session?.remove();
						if (
							bindLinkingToSession &&
							linking &&
							(!currentUser ||
								!startedSession ||
								startedSession !== user_session_id.value)
						)
							return status(
								'Unauthorized',
								'The linking session changed. Start again.'
							);

						const userSessionId =
							user_session_id.value ?? crypto.randomUUID();
						const callbackContext = {
							authClient: clientName,
							authIntent,
							authProvider,
							cookie,
							currentUser,
							originUrl,
							providerConfiguration,
							providerInstance,
							redirect,
							request,
							session: callbackSession,
							status,
							tokenResponse,
							unregisteredSession: callbackUnregisteredSession,
							userSessionId
						} as const;

						const dispatchSuccess = () => {
							if (
								authIntent === 'link_identity' &&
								onLinkIdentity
							) {
								return onLinkIdentity(callbackContext);
							}

							if (
								authIntent === 'link_connector' &&
								onLinkConnector
							) {
								return onLinkConnector(callbackContext);
							}

							return onCallbackSuccess?.(callbackContext);
						};

						const handleDispatchError = (err: unknown) => {
							if (
								authIntent !== 'link_identity' ||
								!(err instanceof AuthIdentityConflictError) ||
								!onLinkIdentityConflict
							) {
								throw err;
							}

							return onLinkIdentityConflict({
								...callbackContext,
								conflict: {
									...err.conflict,
									intent: authIntent
								}
							});
						};

						let response;
						try {
							response = await dispatchSuccess();
						} catch (err) {
							response = await handleDispatchError(err);
						}

						if (authSessionStore) {
							await compatibilityLayer.persist();
						}

						if (response) {
							return response;
						}

						return redirect(originUrl);
					}
				)
		);
