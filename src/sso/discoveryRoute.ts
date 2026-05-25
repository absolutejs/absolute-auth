import { Elysia, t } from 'elysia';
import type { OrganizationId } from '../tenancy';
import { isNonEmptyString } from '../typeGuards';
import type { RouteString } from '../types';
import { DEFAULT_SSO_ROUTE } from './config';
import type { SSOConnectionStore } from './types';

type SsoDiscoveryProps = {
	getOrganizationByEmailDomain: (
		domain: string
	) => OrganizationId | undefined | Promise<OrganizationId | undefined>;
	ssoConnectionStore: SSOConnectionStore;
	ssoRoute?: RouteString;
};

const emailDomain = (email: string) => {
	const atIndex = email.lastIndexOf('@');
	if (atIndex === -1) return '';

	return email.slice(atIndex + 1).toLowerCase();
};

// Home-realm discovery: `GET {ssoRoute}/authorize?email=user@acme.com` resolves the org from the
// email domain, finds its connection, and 302s to the protocol-specific authorize route.
export const ssoDiscoveryRoute = ({
	getOrganizationByEmailDomain,
	ssoConnectionStore,
	ssoRoute = DEFAULT_SSO_ROUTE
}: SsoDiscoveryProps) => {
	const discoveryRoute: RouteString = `${ssoRoute}/authorize`;

	return new Elysia().get(
		discoveryRoute,
		async ({ query: { email }, redirect, status }) => {
			if (!isNonEmptyString(email)) {
				return status(
					'Bad Request',
					'An "email" query parameter is required'
				);
			}

			const domain = emailDomain(email);
			if (domain.length === 0) {
				return status(
					'Bad Request',
					'A valid email address is required'
				);
			}

			const organizationId = await getOrganizationByEmailDomain(domain);
			if (organizationId === undefined) {
				return status(
					'Not Found',
					'No SSO organization is configured for this email domain'
				);
			}

			const connection =
				await ssoConnectionStore.getConnectionByOrganization(
					organizationId
				);
			if (connection === undefined) {
				return status(
					'Not Found',
					'No SSO connection is configured for this organization'
				);
			}

			return redirect(
				`${ssoRoute}/${connection.type}/${organizationId}/authorize`
			);
		},
		{ query: t.Object({ email: t.Optional(t.String()) }) }
	);
};
