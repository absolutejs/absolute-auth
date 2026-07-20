import {
	verifyJwt,
	verifyJwtWithKeys,
	type SigningKeyIdentity
} from '../oidc/keys';
import { verifyDpopProof } from '../oidc/dpop';
import type { AgentCredentialVerifier } from './types';

const BEARER_PREFIX = 'Bearer ';
const MS_PER_SECOND = 1000;

type OidcAgentCredentialVerifierKeys =
	| { publicJwk: JsonWebKey; publicKeys?: never }
	| {
			publicJwk?: never;
			publicKeys: readonly SigningKeyIdentity[];
	  };

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
	isUsedDpopJti,
	maxDpopAgeMs,
	publicJwk,
	publicKeys,
	requireDpop = false,
	resource
}: {
	issuer: string;
	isUsedDpopJti?: (jti: string) => boolean | Promise<boolean>;
	maxDpopAgeMs?: number;
	requireDpop?: boolean;
	resource: string;
} & OidcAgentCredentialVerifierKeys) => {
	const verifier: AgentCredentialVerifier = async (request) => {
		const authorization = request.headers.get('authorization');
		if (
			authorization === null ||
			(!authorization.startsWith(BEARER_PREFIX) &&
				!authorization.startsWith('DPoP '))
		) {
			return undefined;
		}
		const token = authorization
			.slice(authorization.indexOf(' ') + 1)
			.trim();
		if (token.length === 0) return undefined;
		const verified = publicKeys
			? await verifyJwtWithKeys(token, publicKeys)
			: await verifyJwt(token, publicJwk);
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
		const confirmation = payload.cnf;
		const boundJktValue =
			typeof confirmation === 'object' && confirmation !== null
				? Reflect.get(confirmation, 'jkt')
				: undefined;
		const boundJkt =
			typeof boundJktValue === 'string' ? boundJktValue : undefined;
		if (boundJkt !== undefined || requireDpop) {
			if (!authorization.startsWith('DPoP ')) return undefined;
			const proof = await verifyDpopProof({
				accessToken: token,
				htm: request.method,
				htu: request.url,
				isUsedJti: isUsedDpopJti,
				...(maxDpopAgeMs === undefined
					? {}
					: { maxAgeMs: maxDpopAgeMs }),
				proof: request.headers.get('dpop') ?? undefined
			});
			if (
				proof === undefined ||
				boundJkt === undefined ||
				proof.jkt !== boundJkt
			)
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
