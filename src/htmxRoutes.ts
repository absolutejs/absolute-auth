import { isValidProviderOption } from 'citra';
import { Elysia } from 'elysia';
import { protectRoutePlugin } from './protectRoute';
import type { AuthSessionStore } from './sessionTypes';
import { isUserSessionId } from './typeGuards';
import { resolveAuthHtmxRenderers } from './ui/renderers';
import type { AuthHtmxConfig, AuthHtmxUser } from './ui/types';

const SEE_OTHER = 303;

const html = (markup: string) =>
	new Response(markup, {
		headers: { 'content-type': 'text/html; charset=utf-8' }
	});

const signInPrompt = `<section class="auth-content"><h1 class="page-heading">Not authorized</h1><p class="muted">You need to sign in to view this page.</p><a class="btn btn--primary" href="/htmx">Go to sign in</a></section>`;

/* The HTMX fragment routes mounted by `auth`'s `htmx` option. They use
 * the package's fragment renderers and gate every data route behind
 * `protectRoute`; the identity/connector data operations are supplied via the
 * config so the auth package stays agnostic of your storage schema. */
export const createAuthHtmxRoutes = <UserType extends AuthHtmxUser>(
	config: AuthHtmxConfig & {
		authSessionStore?: AuthSessionStore<UserType>;
	}
) => {
	const renderers = resolveAuthHtmxRenderers(config);
	const authorizationHref =
		config.authorizationHref ??
		((provider: string) => `/oauth2/${provider}/authorization`);

	return new Elysia()
		.use(
			protectRoutePlugin<UserType>({
				authSessionStore: config.authSessionStore
			})
		)
		.get('/htmx/login', () =>
			html(renderers.providerLogin('Sign in with', true))
		)
		.get('/htmx/link', () => html(renderers.providerLogin('Link', false)))
		.get('/htmx/connector-links', () => html(renderers.connectorLinks()))
		.get('/htmx/auth-menu', ({ protectRoute }) =>
			protectRoute(
				(user) => html(renderers.authMenu(user)),
				() => html(renderers.authMenu(null))
			)
		)
		.get('/htmx/me', ({ protectRoute }) =>
			protectRoute(
				(user) => html(renderers.protected(user)),
				() => html(signInPrompt)
			)
		)
		.get('/htmx/account', ({ protectRoute }) =>
			protectRoute(
				(user) => html(renderers.account(user)),
				() => html(signInPrompt)
			)
		)
		.get('/htmx/identities', ({ protectRoute, query }) =>
			protectRoute(async (user) => {
				const search =
					typeof query.query === 'string' ? query.query : '';

				return html(
					renderers.identities(
						await config.loadAuthIdentities(user.sub),
						search
					)
				);
			})
		)
		.post('/htmx/identities/:id/primary', ({ params, protectRoute }) =>
			protectRoute(async (user) => {
				try {
					await config.setPrimaryIdentity({
						identityId: params.id,
						userSub: user.sub
					});
				} catch {
					// ignore — re-render reflects current state
				}

				return html(
					renderers.identities(
						await config.loadAuthIdentities(user.sub),
						''
					)
				);
			})
		)
		.delete('/htmx/identities/:id', ({ params, protectRoute }) =>
			protectRoute(async (user) => {
				const payload = await config.loadAuthIdentities(user.sub);
				const identities = Object.values(payload.identities).flat();
				const identity = identities.find(
					(candidate) => candidate.id === params.id
				);
				if (
					identity &&
					identities.length > 1 &&
					identity.isPrimary !== true
				) {
					await config.removeIdentity({
						identityId: identity.id,
						userSub: user.sub
					});
				}

				return html(
					renderers.identities(
						await config.loadAuthIdentities(user.sub),
						''
					)
				);
			})
		)
		.post('/htmx/merge/:id', ({ params, protectRoute }) =>
			protectRoute(async (user) => {
				try {
					await config.mergeIdentity({
						mergeRequestId: params.id,
						userSub: user.sub
					});
				} catch {
					// ignore — re-render reflects current state
				}

				return html(
					renderers.identities(
						await config.loadAuthIdentities(user.sub),
						''
					)
				);
			})
		)
		.delete('/htmx/merge/:id', ({ params, protectRoute }) =>
			protectRoute(async (user) => {
				await config.dismissMergeRequest({
					mergeRequestId: params.id,
					userSub: user.sub
				});

				return html(
					renderers.identities(
						await config.loadAuthIdentities(user.sub),
						''
					)
				);
			})
		)
		.get('/htmx/connector-list', ({ protectRoute }) =>
			protectRoute(
				async (user) =>
					html(
						renderers.connectors(
							await config.loadLinkedProviders(user.sub)
						)
					),
				() => html(signInPrompt)
			)
		)
		.delete('/htmx/connectors/grants/:id', ({ params, protectRoute }) =>
			protectRoute(async (user) => {
				await config.removeGrant({
					grantId: params.id,
					userSub: user.sub
				});

				return html(
					renderers.connectors(
						await config.loadLinkedProviders(user.sub)
					)
				);
			})
		)
		.delete('/htmx/connectors/bindings/:id', ({ params, protectRoute }) =>
			protectRoute(async (user) => {
				await config.removeBinding({
					bindingId: params.id,
					userSub: user.sub
				});

				return html(
					renderers.connectors(
						await config.loadLinkedProviders(user.sub)
					)
				);
			})
		)
		.get('/htmx/login-redirect', ({ query, redirect }) => {
			const provider =
				typeof query.provider === 'string' ? query.provider : '';

			return redirect(
				isValidProviderOption(provider)
					? authorizationHref(provider)
					: '/htmx'
			);
		})
		.post('/htmx/delete-account', (context) =>
			context.protectRoute(async (user) => {
				const confirm =
					typeof context.body === 'object' &&
					context.body !== null &&
					'confirm' in context.body
						? String(context.body.confirm)
						: '';
				if (confirm !== 'DELETE') {
					return html(
						`<div class="error-banner">Type DELETE to confirm.</div>`
					);
				}

				await config.deleteAccount({ userSub: user.sub });
				context.set.headers['HX-Redirect'] = '/htmx';

				return html('');
			})
		)
		.get(
			'/htmx/signout',
			async ({ cookie: { user_session_id }, redirect }) => {
				const sessionId = user_session_id.value;
				if (sessionId !== undefined && isUserSessionId(sessionId)) {
					await config.authSessionStore?.removeSession(sessionId);
				}
				user_session_id.remove();

				return redirect('/htmx', SEE_OTHER);
			}
		);
};
