import { Elysia, t } from 'elysia';
import { verifyOidcAccessToken } from '../principal';
import type { RouteString } from '../types';
import { DEFAULT_OIDC_ROUTE, type OidcProviderConfig } from './config';
import { issueSocketTicket } from './socketTickets';

const noStoreJson = (value: unknown, status: number) =>
	new Response(JSON.stringify(value), {
		headers: {
			'cache-control': 'no-store',
			'content-type': 'application/json'
		},
		status
	});

/** Isolated plugin keeps the already-large provider route type from expanding
 * for applications that do not enable socket tickets. */
type SocketTicketRoutes = <UserType>(
	config: OidcProviderConfig<UserType>
) => Elysia;

export const socketTicketRoutes: SocketTicketRoutes = (config) => {
	const store = config.socketTicketStore;
	if (!store) return new Elysia();
	const route: RouteString = `${config.oidcRoute ?? DEFAULT_OIDC_ROUTE}/socket-ticket`;

	return new Elysia().post(
		route,
		{
			body: t.Object({ audience: t.Optional(t.String()) }),
			headers: t.Object({ authorization: t.Optional(t.String()) })
		},
		async ({ body, headers }) => {
			const principal = await verifyOidcAccessToken({
				authorization: headers.authorization,
				oidc: config
			});
			if (!principal)
				return new Response(null, {
					headers: {
						'cache-control': 'no-store',
						'www-authenticate': 'Bearer'
					},
					status: 401
				});
			const audience = body.audience ?? config.issuer;
			const allowed =
				audience === config.issuer ||
				(await config.allowSocketTicketAudience?.({
					audience,
					clientId: principal.clientId,
					scopes: principal.scopes,
					subject: principal.subject
				}));
			if (!allowed) return noStoreJson({ error: 'invalid_target' }, 400);
			const issued = await issueSocketTicket({
				audience,
				clientId: principal.clientId,
				scopes: principal.scopes,
				store,
				subject: principal.subject,
				ttlMs: config.socketTicketTtlMs
			});

			return noStoreJson(
				{
					expires_in: Math.ceil(issued.expiresInMs / 1000),
					ticket: issued.ticket
				},
				200
			);
		}
	);
};
