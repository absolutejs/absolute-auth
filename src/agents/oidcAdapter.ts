import { verifyJwt } from '../oidc/keys';
import type { AgentCredentialVerifier } from './types';

const BEARER_PREFIX = 'Bearer ';
const MS_PER_SECOND = 1000;

const readAudience = (audience: unknown) => {
	if (typeof audience === 'string') return [audience];
	if (
		Array.isArray(audience) &&
		audience.every((entry) => typeof entry === 'string')
	) {
		return audience;
	}

	return [];
};

/** Adapter for Absolute Auth's RFC 9068-style JWT access tokens. It validates
 * signature, issuer, audience, expiry, and extracts the OAuth client as the
 * agent identity while retaining `sub` as the authorizing user. */
export const createOidcAgentCredentialVerifier = ({
	issuer,
	publicJwk,
	resource
}: {
	issuer: string;
	publicJwk: JsonWebKey;
	resource: string;
}) => {
	const verifier: AgentCredentialVerifier = async (request) => {
		const authorization = request.headers.get('authorization');
		if (
			authorization === null ||
			!authorization.startsWith(BEARER_PREFIX)
		) {
			return undefined;
		}
		const token = authorization.slice(BEARER_PREFIX.length).trim();
		if (token.length === 0) return undefined;
		const verified = await verifyJwt(token, publicJwk);
		const payload = verified?.payload;
		if (
			payload === undefined ||
			payload.iss !== issuer ||
			typeof payload.exp !== 'number' ||
			payload.exp <= Math.floor(Date.now() / MS_PER_SECOND) ||
			!readAudience(payload.aud).includes(resource) ||
			typeof payload.client_id !== 'string'
		) {
			return undefined;
		}

		return {
			agentId: payload.client_id,
			claims: payload,
			expiresAt: payload.exp * MS_PER_SECOND,
			organizationId:
				typeof payload.organization_id === 'string'
					? payload.organization_id
					: undefined,
			resource,
			scopes:
				typeof payload.scope === 'string'
					? payload.scope.split(' ').filter(Boolean)
					: [],
			userId: typeof payload.sub === 'string' ? payload.sub : undefined
		};
	};

	return verifier;
};
