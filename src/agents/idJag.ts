import { MILLISECONDS_IN_A_SECOND } from '../constants';
import { signJwt, verifyJwt, type SigningKey } from '../oidc/keys';
import { AGENT_IDENTITY_ASSERTION_TYPE } from './registration';
import type { VerifiedAgentIdentityAssertion } from './types';

export type AgentIdentityAssertionJtiStore = {
	/** Atomically records an issuer+jti pair. Returns false for a replay. */
	recordIfFresh: (
		issuer: string,
		jti: string,
		expiresAt: number
	) => Promise<boolean>;
};

export const createInMemoryAgentIdentityAssertionJtiStore =
	(): AgentIdentityAssertionJtiStore => {
		const entries = new Map<string, number>();

		return {
			recordIfFresh: async (issuer, jti, expiresAt) => {
				const now = Date.now();
				for (const [key, expiry] of entries) {
					if (expiry <= now) entries.delete(key);
				}
				const key = `${issuer}\u0000${jti}`;
				if (entries.has(key)) return false;
				entries.set(key, expiresAt);

				return true;
			}
		};
	};

export type AgentIdentityAssertionUser = {
	authenticatedAt: number;
	email?: string;
	emailVerified?: boolean;
	methods?: string[];
	name?: string;
	phoneNumber?: string;
	phoneNumberVerified?: boolean;
	subject: string;
};

/** Native provider-side ID-JAG issuance. The caller owns the user consent UI
 * and must authorize the requested audience before invoking this helper. */
export const issueAgentIdentityAssertion = async ({
	agentContextId,
	agentPlatform,
	audience,
	clientId,
	issuer,
	now = Date.now(),
	resource,
	signingKey,
	ttlMs = 5 * 60 * MILLISECONDS_IN_A_SECOND,
	user
}: {
	agentContextId?: string;
	agentPlatform?: string;
	audience: string;
	clientId: string;
	issuer: string;
	now?: number;
	resource?: string;
	signingKey: SigningKey;
	ttlMs?: number;
	user: AgentIdentityAssertionUser;
}) => {
	if (user.emailVerified !== true && user.phoneNumberVerified !== true) {
		throw new Error(
			'ID-JAG issuance requires a verified email or phone number'
		);
	}
	const expiresAt = now + ttlMs;
	const payload: Record<string, unknown> = {
		aud: audience,
		auth_time: Math.floor(user.authenticatedAt / MILLISECONDS_IN_A_SECOND),
		client_id: clientId,
		exp: Math.floor(expiresAt / MILLISECONDS_IN_A_SECOND),
		iat: Math.floor(now / MILLISECONDS_IN_A_SECOND),
		iss: issuer,
		jti: crypto.randomUUID(),
		sub: user.subject
	};
	if (user.email !== undefined) payload.email = user.email;
	if (user.emailVerified !== undefined)
		payload.email_verified = user.emailVerified;
	if (user.name !== undefined) payload.name = user.name;
	if (user.phoneNumber !== undefined) payload.phone_number = user.phoneNumber;
	if (user.phoneNumberVerified !== undefined)
		payload.phone_number_verified = user.phoneNumberVerified;
	if (user.methods !== undefined) payload.amr = user.methods;
	if (resource !== undefined) payload.resource = resource;
	if (agentPlatform !== undefined) payload.agent_platform = agentPlatform;
	if (agentContextId !== undefined) payload.agent_context_id = agentContextId;

	return {
		assertion: await signJwt(payload, signingKey, 'oauth-id-jag+jwt'),
		assertionType: AGENT_IDENTITY_ASSERTION_TYPE,
		expiresAt
	};
};

const numberClaim = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const stringClaim = (value: unknown) =>
	typeof value === 'string' && value.length > 0 ? value : undefined;

/** Builds a fail-closed service-side verifier. Issuer resolution is injected so
 * the application can use pinned configuration, CIMD, or an egress-guarded
 * JWKS resolver without this package performing ambient network access. */
export const createAgentIdentityAssertionVerifier =
	({
		audience,
		clockSkewMs = MILLISECONDS_IN_A_SECOND * 60,
		jtiStore,
		maxAssertionLifetimeMs = MILLISECONDS_IN_A_SECOND * 60 * 60,
		maxAuthenticationAgeMs = MILLISECONDS_IN_A_SECOND * 60 * 60,
		resolveIssuer
	}: {
		audience: string;
		clockSkewMs?: number;
		jtiStore: AgentIdentityAssertionJtiStore;
		maxAssertionLifetimeMs?: number;
		maxAuthenticationAgeMs?: number;
		resolveIssuer: (issuer: string) => Promise<
			| {
					allowedClientIds?: string[];
					publicJwk: JsonWebKey;
			  }
			| undefined
		>;
	}) =>
	async (
		assertion: string,
		now = Date.now()
	): Promise<VerifiedAgentIdentityAssertion | undefined> => {
		const segments = assertion.split('.');
		if (segments.length !== 3 || segments[1] === undefined)
			return undefined;
		let decoded: unknown;
		try {
			decoded = JSON.parse(
				Buffer.from(segments[1], 'base64url').toString('utf8')
			);
		} catch {
			return undefined;
		}
		if (
			typeof decoded !== 'object' ||
			decoded === null ||
			Array.isArray(decoded)
		) {
			return undefined;
		}
		const unverified = Object.fromEntries(Object.entries(decoded));
		const issuer = stringClaim(unverified.iss);
		if (issuer === undefined) return undefined;
		const trusted = await resolveIssuer(issuer);
		if (trusted === undefined) return undefined;
		const verified = await verifyJwt(assertion, trusted.publicJwk);
		if (verified?.header?.typ !== 'oauth-id-jag+jwt') return undefined;
		const { payload } = verified;
		const subject = stringClaim(payload.sub);
		const jti = stringClaim(payload.jti);
		const clientId = stringClaim(payload.client_id);
		const expiresAtSeconds = numberClaim(payload.exp);
		const issuedAtSeconds = numberClaim(payload.iat);
		const authenticatedAtSeconds = numberClaim(payload.auth_time);
		if (
			payload.iss !== issuer ||
			payload.aud !== audience ||
			subject === undefined ||
			jti === undefined ||
			clientId === undefined ||
			expiresAtSeconds === undefined ||
			issuedAtSeconds === undefined ||
			authenticatedAtSeconds === undefined
		) {
			return undefined;
		}
		const expiresAt = expiresAtSeconds * MILLISECONDS_IN_A_SECOND;
		const issuedAt = issuedAtSeconds * MILLISECONDS_IN_A_SECOND;
		const authenticatedAt =
			authenticatedAtSeconds * MILLISECONDS_IN_A_SECOND;
		if (
			expiresAt <= now - clockSkewMs ||
			issuedAt > now + clockSkewMs ||
			expiresAt <= issuedAt ||
			expiresAt - issuedAt > maxAssertionLifetimeMs + clockSkewMs ||
			authenticatedAt > now + clockSkewMs ||
			authenticatedAt > issuedAt + clockSkewMs ||
			now - authenticatedAt > maxAuthenticationAgeMs + clockSkewMs
		) {
			return undefined;
		}
		if (
			trusted.allowedClientIds !== undefined &&
			!trusted.allowedClientIds.includes(clientId)
		) {
			return undefined;
		}
		const email = stringClaim(payload.email);
		const phoneNumber = stringClaim(payload.phone_number);
		const emailVerified = payload.email_verified === true;
		const phoneNumberVerified = payload.phone_number_verified === true;
		if (!emailVerified && !phoneNumberVerified) return undefined;
		if (!(await jtiStore.recordIfFresh(issuer, jti, expiresAt))) {
			return undefined;
		}

		return {
			authenticatedAt,
			clientId,
			email,
			emailVerified,
			issuer,
			name: stringClaim(payload.name),
			phoneNumber,
			phoneNumberVerified,
			subject
		};
	};
