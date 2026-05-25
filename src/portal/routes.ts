import { Elysia, t } from 'elysia';
import { createScimToken, DEFAULT_SCIM_ROUTE } from '../scim/config';
import { DEFAULT_SSO_ROUTE } from '../sso/config';
import type { OidcConnection, SamlConnection } from '../sso/types';
import { DEFAULT_PORTAL_ROUTE, type PortalRouteProps } from './config';
import { resolveSetupSession } from './operations';

const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile'];

// The headless admin-portal API. Every route authenticates with the setup token (Bearer), is
// scoped to that link's organization + capabilities, and writes through the same SSO / SCIM stores
// the rest of the package uses. The JSON contract is framework-agnostic: build the portal UI in
// any of the supported frameworks (or none) against these endpoints. `auth()` mounts this when a
// `portal` block is configured.
export const portalRoutes = ({
	emit,
	onScimTokenCreated,
	onSsoConnectionConfigured,
	portalRoute = DEFAULT_PORTAL_ROUTE,
	scimRoute = DEFAULT_SCIM_ROUTE,
	scimTokenStore,
	setupSessionStore,
	ssoConnectionStore,
	ssoRoute = DEFAULT_SSO_ROUTE
}: PortalRouteProps) => {
	const loadSession = (authorization: string | undefined) =>
		resolveSetupSession({ authorization, setupSessionStore });
	const oidcRedirectUri = (origin: string, organizationId: string) =>
		`${origin}${ssoRoute}/oidc/${organizationId}/callback`;

	return new Elysia()
		.get(`${portalRoute}/session`, async ({ headers, request, status }) => {
			const session = await loadSession(headers.authorization);
			if (!session) {
				return status('Unauthorized', 'Invalid or expired setup link');
			}

			const { capabilities, expiresAt, organizationId } = session;
			const { origin } = new URL(request.url);
			const metadataUrl = `${origin}${ssoRoute}/saml/${organizationId}/metadata`;
			const samlConfigured =
				ssoConnectionStore !== undefined &&
				capabilities.includes('sso_saml')
					? (await ssoConnectionStore.getConnectionByOrganization(
							organizationId,
							'saml'
						)) !== undefined
					: false;
			const oidcConfigured =
				ssoConnectionStore !== undefined &&
				capabilities.includes('sso_oidc')
					? (await ssoConnectionStore.getConnectionByOrganization(
							organizationId,
							'oidc'
						)) !== undefined
					: false;

			return status('OK', {
				capabilities,
				configured: { oidc: oidcConfigured, saml: samlConfigured },
				expiresAt,
				oidc: capabilities.includes('sso_oidc')
					? { redirectUri: oidcRedirectUri(origin, organizationId) }
					: undefined,
				organizationId,
				saml: capabilities.includes('sso_saml')
					? {
							acsUrl: `${origin}${ssoRoute}/saml/${organizationId}/acs`,
							entityId: metadataUrl,
							metadataUrl
						}
					: undefined,
				scim: capabilities.includes('scim')
					? { baseUrl: `${origin}${scimRoute}` }
					: undefined
			});
		})
		.put(
			`${portalRoute}/connection/saml`,
			async ({ body, headers, status }) => {
				const session = await loadSession(headers.authorization);
				if (!session) {
					return status(
						'Unauthorized',
						'Invalid or expired setup link'
					);
				}
				if (!session.capabilities.includes('sso_saml')) {
					return status(
						'Forbidden',
						'This setup link cannot configure SAML'
					);
				}
				if (!ssoConnectionStore) {
					return status('Not Implemented', 'SSO is not configured');
				}

				const { organizationId } = session;
				const existing =
					await ssoConnectionStore.getConnectionByOrganization(
						organizationId,
						'saml'
					);
				const now = Date.now();
				const connection: SamlConnection = {
					config: {
						idpEntityId: body.idpEntityId,
						idpSloUrl: body.idpSloUrl,
						idpSsoUrl: body.idpSsoUrl,
						idpX509Cert: body.idpX509Cert
					},
					connectionId: existing?.connectionId ?? crypto.randomUUID(),
					createdAt: existing?.createdAt ?? now,
					enabled: true,
					organizationId,
					type: 'saml',
					updatedAt: now
				};
				await ssoConnectionStore.saveConnection(connection);
				await emit?.({
					at: now,
					organizationId,
					type: 'sso_connection_configured'
				});
				await onSsoConnectionConfigured?.({
					organizationId,
					type: 'saml'
				});

				return status('OK', { configured: true, type: 'saml' });
			},
			{
				body: t.Object({
					idpEntityId: t.String(),
					idpSloUrl: t.Optional(t.String()),
					idpSsoUrl: t.String(),
					idpX509Cert: t.String()
				})
			}
		)
		.put(
			`${portalRoute}/connection/oidc`,
			async ({ body, headers, request, status }) => {
				const session = await loadSession(headers.authorization);
				if (!session) {
					return status(
						'Unauthorized',
						'Invalid or expired setup link'
					);
				}
				if (!session.capabilities.includes('sso_oidc')) {
					return status(
						'Forbidden',
						'This setup link cannot configure OIDC'
					);
				}
				if (!ssoConnectionStore) {
					return status('Not Implemented', 'SSO is not configured');
				}

				const { organizationId } = session;
				const { origin } = new URL(request.url);
				const existing =
					await ssoConnectionStore.getConnectionByOrganization(
						organizationId,
						'oidc'
					);
				const now = Date.now();
				const connection: OidcConnection = {
					config: {
						clientId: body.clientId,
						clientSecret: body.clientSecret,
						issuer: body.issuer,
						redirectUri:
							body.redirectUri ??
							oidcRedirectUri(origin, organizationId),
						scopes: body.scopes ?? DEFAULT_OIDC_SCOPES
					},
					connectionId: existing?.connectionId ?? crypto.randomUUID(),
					createdAt: existing?.createdAt ?? now,
					enabled: true,
					organizationId,
					type: 'oidc',
					updatedAt: now
				};
				await ssoConnectionStore.saveConnection(connection);
				await emit?.({
					at: now,
					organizationId,
					type: 'sso_connection_configured'
				});
				await onSsoConnectionConfigured?.({
					organizationId,
					type: 'oidc'
				});

				return status('OK', { configured: true, type: 'oidc' });
			},
			{
				body: t.Object({
					clientId: t.String(),
					clientSecret: t.String(),
					issuer: t.String(),
					redirectUri: t.Optional(t.String()),
					scopes: t.Optional(t.Array(t.String()))
				})
			}
		)
		.post(
			`${portalRoute}/scim/token`,
			async ({ headers, request, status }) => {
				const session = await loadSession(headers.authorization);
				if (!session) {
					return status(
						'Unauthorized',
						'Invalid or expired setup link'
					);
				}
				if (!session.capabilities.includes('scim')) {
					return status(
						'Forbidden',
						'This setup link cannot configure SCIM'
					);
				}
				if (!scimTokenStore) {
					return status('Not Implemented', 'SCIM is not configured');
				}

				const { organizationId } = session;
				const { token, tokenId } = await createScimToken(
					scimTokenStore,
					organizationId
				);
				const { origin } = new URL(request.url);
				await emit?.({
					at: Date.now(),
					organizationId,
					type: 'scim_token_created'
				});
				await onScimTokenCreated?.({ organizationId, tokenId });

				return status('OK', {
					baseUrl: `${origin}${scimRoute}`,
					token,
					tokenId
				});
			}
		);
};
