
import type { AccessTokenStore } from '../apikeys/types';
import {
	MILLISECONDS_IN_A_MINUTE,
	MILLISECONDS_IN_A_SECOND
} from '../constants';
import { constantTimeEqual, generateSecureToken, hashToken } from '../crypto';
import { signJwt, verifyJwt, type SigningKey } from '../oidc/keys';
import type { RouteString } from '../types';
import type {
	AgentAuthConfig,
	AgentRegistrationDiscoveryMetadata
} from './config';
import type {
	AgentIdentityRegistration,
	AgentIdentityRegistrationKind,
	AgentIdentityRegistrationStore,
	VerifiedAgentIdentityAssertion
} from './types';

export const AGENT_CLAIM_GRANT_TYPE =
	'urn:workos:agent-auth:grant-type:claim' as const;
export const AGENT_IDENTITY_ASSERTION_GRANT_TYPE =
	'urn:ietf:params:oauth:grant-type:jwt-bearer' as const;
export const AGENT_IDENTITY_ASSERTION_TYPE =
	'urn:ietf:params:oauth:token-type:id-jag' as const;
const DEFAULT_IDENTITY_ROUTE: RouteString = '/agent/identity';
const DEFAULT_CLAIM_ROUTE: RouteString = '/agent/identity/claim';
const DEFAULT_COMPLETE_ROUTE: RouteString = '/agent/identity/claim/complete';
const DEFAULT_GUIDE_ROUTE: RouteString = '/auth.md';
const DEFAULT_CLAIM_TTL_MS = 24 * 60 * MILLISECONDS_IN_A_MINUTE;
const DEFAULT_ATTEMPT_TTL_MS = 10 * MILLISECONDS_IN_A_MINUTE;
const DEFAULT_ASSERTION_TTL_MS = 60 * MILLISECONDS_IN_A_MINUTE;
const DEFAULT_ACCESS_TOKEN_TTL_MS = 15 * MILLISECONDS_IN_A_MINUTE;
const DEFAULT_MAX_AUTH_AGE_MS = 60 * MILLISECONDS_IN_A_MINUTE;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_MAX_CODE_ATTEMPTS = 5;
const MAX_CONCURRENT_UPDATE_RETRIES = 5;
const TOKEN_BYTES = 32;

export type AgentRegistrationAuthenticatedUser = {
	email?: string;
	userId: string;
};

export type AgentRegistrationProtocolConfig = {
	accessTokenStore: AccessTokenStore;
	allowAnonymous?: boolean;
	allowServiceAuth?: boolean;
	assertionTtlMs?: number;
	attemptTtlMs?: number;
	claimRoute?: RouteString;
	claimTtlMs?: number;
	completeRoute?: RouteString;
	guideRoute?: RouteString;
	identityRoute?: RouteString;
	identityStore: AgentIdentityRegistrationStore;
	maxAuthenticationAgeMs?: number;
	maxCodeAttempts?: number;
	pollIntervalSeconds?: number;
	postClaimScopes: string[];
	preClaimScopes?: string[];
	resolveAuthenticatedUser: (
		request: Request
	) => Promise<AgentRegistrationAuthenticatedUser | undefined>;
	/** Match a cryptographically verified upstream identity to local state. A
	 * userId permits immediate registration; omitting it requires a user claim. */
	resolveVerifiedIdentity?: (
		identity: VerifiedAgentIdentityAssertion
	) => Promise<{ userId?: string } | undefined>;
	/** Bulk-revokes access tokens for an agent. Required for anonymous
	 * registration and recommended for immediate cleanup on any revocation. It
	 * must be idempotent because atomic state updates may be retried. */
	revokeAccessTokens?: (agentId: string) => Promise<void>;
	signingKey: SigningKey;
	tokenTtlMs?: number;
	verifyIdentityAssertion?: (
		assertion: string
	) => Promise<VerifiedAgentIdentityAssertion | undefined>;
};

export type AgentRegistrationEndpoints = {
	claimEndpoint: string;
	completeEndpoint: string;
	guide: string;
	identityEndpoint: string;
	tokenEndpoint: string;
};

export const agentRegistrationDiscoveryMetadata = (
	config: AgentAuthConfig
): AgentRegistrationDiscoveryMetadata => {
	const registration = requiredRegistration(config);
	const endpoints = agentRegistrationEndpoints(config);
	const identityTypes = ['identity_assertion'];
	if (registration.allowAnonymous === true)
		identityTypes.unshift('anonymous');
	if (registration.allowServiceAuth === true)
		identityTypes.push('service_auth');

	return {
		claim_endpoint: endpoints.claimEndpoint,
		identity_assertion: {
			assertion_types_supported: [AGENT_IDENTITY_ASSERTION_TYPE]
		},
		identity_endpoint: endpoints.identityEndpoint,
		identity_types_supported: identityTypes,
		skill: endpoints.guide
	};
};
export const agentRegistrationEndpoints = (
	config: AgentAuthConfig
): AgentRegistrationEndpoints => {
	const registration = requiredRegistration(config);
	const base = config.authorizationServer;
	const oidcRoute = config.oidcRoute ?? '/oauth2';

	return {
		claimEndpoint: new URL(
			registration.claimRoute ?? DEFAULT_CLAIM_ROUTE,
			base
		).toString(),
		completeEndpoint: new URL(
			registration.completeRoute ?? DEFAULT_COMPLETE_ROUTE,
			base
		).toString(),
		guide: new URL(
			registration.guideRoute ?? DEFAULT_GUIDE_ROUTE,
			base
		).toString(),
		identityEndpoint: new URL(
			registration.identityRoute ?? DEFAULT_IDENTITY_ROUTE,
			base
		).toString(),
		tokenEndpoint: new URL(`${oidcRoute}/token`, base).toString()
	};
};

const markdownJson = (value: unknown) =>
	`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

/** Generates the agent-readable companion document. Endpoint URLs and support
 * flags come from the same structured configuration used for discovery, so the
 * prose cannot silently drift from the authorization server metadata. */
export const generateAgentRegistrationGuide = (config: AgentAuthConfig) => {
	const registration = requiredRegistration(config);
	const endpoints = agentRegistrationEndpoints(config);
	const metadataUrl = new URL(
		config.metadataRoute ?? '/.well-known/oauth-protected-resource',
		config.resource
	).toString();
	const methods = [
		'- `identity_assertion`: present an audience-bound ID-JAG from a trusted provider.',
		...(registration.allowServiceAuth === true
			? [
					'- `service_auth`: provide a user login hint and complete the service-owned claim ceremony.'
				]
			: []),
		...(registration.allowAnonymous === true
			? [
					'- `anonymous`: receive pre-claim scopes, then optionally let a signed-in user claim the registration.'
				]
			: [])
	].join('\n');

	return `# Agent registration for ${config.resourceName ?? config.resource}

This service supports the open auth.md agent-registration profile. Structured
OAuth metadata is authoritative; this document is its agent-readable companion.

## 1. Discover

Fetch ${metadataUrl}, follow \`authorization_servers\`, then fetch
\`/.well-known/oauth-authorization-server\`. Read its \`agent_auth\` object and
top-level \`token_endpoint\` and \`grant_types_supported\` fields.

## 2. Choose a method

${methods}

Before asserting a user identity, show the service name and requested scopes to
the user and obtain consent. Never ask the user to send a password or OTP to the
agent.

## 3. Register

POST one of these bodies to ${endpoints.identityEndpoint}:

${markdownJson({
	assertion: '<ID-JAG>',
	assertion_type: AGENT_IDENTITY_ASSERTION_TYPE,
	type: 'identity_assertion'
})}

${registration.allowServiceAuth === true ? markdownJson({ login_hint: 'user@example.com', type: 'service_auth' }) : ''}

${registration.allowAnonymous === true ? markdownJson({ type: 'anonymous' }) : ''}

## 4. Claim

Surface \`verification_uri\` and \`user_code\` together. The user opens the
service-owned page, signs in using the service's normal MFA/SSO policy, and types
the code there. Poll ${endpoints.tokenEndpoint} using
\`grant_type=${AGENT_CLAIM_GRANT_TYPE}\` and the one-time \`claim_token\`.
Treat \`authorization_pending\` as retryable, honor \`interval\`, and restart
when the server returns \`expired_token\`.

## 5. Exchange and use credentials

Exchange \`identity_assertion\` at ${endpoints.tokenEndpoint} with
\`grant_type=${AGENT_IDENTITY_ASSERTION_GRANT_TYPE}\`. Present the resulting
access token as \`Authorization: Bearer <access_token>\`. Credentials are scoped,
short-lived, revocable, and bound to the registered agent identity.

## Errors and safety

- Stop on \`invalid_issuer\`, \`invalid_signature\`, \`invalid_audience\`, or \`replay_detected\`.
- Reauthenticate the user on \`login_required\`.
- Open the service-owned confirmation URL on \`interaction_required\`.
- Never persist claim tokens after completion and never expose credentials in model context.
`;
};

const requiredRegistration = (config: AgentAuthConfig) => {
	if (config.agentRegistration === undefined) {
		throw new Error('agentAuth.agentRegistration is not configured');
	}

	return config.agentRegistration;
};

const randomCode = () => {
	const bytes = crypto.getRandomValues(new Uint8Array(4));
	const value = new DataView(bytes.buffer).getUint32(0) % 1_000_000;

	return value.toString().padStart(6, '0');
};

const makeSecret = (prefix: string) =>
	`${prefix}_${generateSecureToken(TOKEN_BYTES)}`;

const makeAttempt = async ({
	email,
	now,
	registration
}: {
	email: string;
	now: number;
	registration: AgentRegistrationProtocolConfig;
}) => {
	const attemptToken = makeSecret('cat');
	const userCode = randomCode();
	const expiresAt =
		now + (registration.attemptTtlMs ?? DEFAULT_ATTEMPT_TTL_MS);

	return {
		attempt: {
			attempts: 0,
			email: email.toLowerCase(),
			expiresAt,
			tokenHash: await hashToken(attemptToken),
			userCodeHash: await hashToken(userCode)
		},
		attemptToken,
		expiresAt,
		userCode
	};
};

const createFlow = async ({
	agentId,
	kind,
	loginHint,
	now,
	registration,
	status,
	upstream,
	userId,
	withAttempt
}: {
	agentId: string;
	kind: AgentIdentityRegistrationKind;
	loginHint?: string;
	now: number;
	registration: AgentRegistrationProtocolConfig;
	status: AgentIdentityRegistration['status'];
	upstream?: AgentIdentityRegistration['upstream'];
	userId?: string;
	withAttempt?: string;
}) => {
	const claimToken = makeSecret('clm');
	const registrationId = `air_${crypto.randomUUID()}`;
	const claimExpiresAt =
		now + (registration.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS);
	const attempt =
		withAttempt === undefined
			? undefined
			: await makeAttempt({ email: withAttempt, now, registration });
	const flow: AgentIdentityRegistration = {
		agentId,
		claimAttempt: attempt?.attempt,
		claimExpiresAt,
		claimTokenHash: await hashToken(claimToken),
		createdAt: now,
		expiresAt: claimExpiresAt,
		kind,
		loginHint,
		registrationId,
		status,
		updatedAt: now,
		upstream,
		userId,
		version: 1
	};
	if (!(await registration.identityStore.create(flow))) {
		throw new Error('Agent identity registration id collision');
	}

	return { attempt, claimToken, flow };
};

const assertionClaims = (
	config: AgentAuthConfig,
	flow: AgentIdentityRegistration,
	now: number
) => ({
	aud: config.authorizationServer,
	exp: Math.floor(
		(now +
			(config.agentRegistration?.assertionTtlMs ??
				DEFAULT_ASSERTION_TTL_MS)) /
			MILLISECONDS_IN_A_SECOND
	),
	iat: Math.floor(now / MILLISECONDS_IN_A_SECOND),
	iss: config.authorizationServer,
	jti: crypto.randomUUID(),
	registration_version: flow.version,
	sub: flow.registrationId
});

export const issueAgentServiceAssertion = async (
	config: AgentAuthConfig,
	flow: AgentIdentityRegistration,
	now = Date.now()
) => ({
	assertion: await signJwt(
		assertionClaims(config, flow, now),
		requiredRegistration(config).signingKey,
		'oauth-id-jag+jwt'
	),
	expiresAt:
		now +
		(requiredRegistration(config).assertionTtlMs ??
			DEFAULT_ASSERTION_TTL_MS)
});

const activateAgent = async (
	config: AgentAuthConfig,
	flow: AgentIdentityRegistration,
	scopes: string[]
) => {
	const now = Date.now();
	await config.registrationStore.saveRegistration({
		agentId: flow.agentId,
		allowedScopes: scopes.filter((scope) => config.scopes.includes(scope)),
		createdAt: now,
		metadata: {
			identityRegistrationId: flow.registrationId,
			registrationKind: flow.kind
		},
		name: `Agent registration ${flow.registrationId}`,
		status: 'active',
		updatedAt: now
	});
	if (flow.userId !== undefined) {
		await config.delegationStore.saveDelegation({
			agentId: flow.agentId,
			createdAt: now,
			delegationId: `agd_${crypto.randomUUID()}`,
			scopes: scopes.filter((scope) => config.scopes.includes(scope)),
			status: 'active',
			updatedAt: now,
			userId: flow.userId
		});
	}
};

const ceremony = (
	config: AgentAuthConfig,
	flow: AgentIdentityRegistration,
	attempt: NonNullable<Awaited<ReturnType<typeof createFlow>>['attempt']>
) => ({
	expires_in: Math.max(
		0,
		Math.floor((attempt.expiresAt - Date.now()) / MILLISECONDS_IN_A_SECOND)
	),
	interval:
		requiredRegistration(config).pollIntervalSeconds ??
		DEFAULT_POLL_INTERVAL_SECONDS,
	user_code: attempt.userCode,
	verification_uri: `${agentRegistrationEndpoints(config).completeEndpoint}?claim_attempt_token=${encodeURIComponent(attempt.attemptToken)}`
});

export type StartAgentRegistrationInput =
	| { type: 'anonymous' }
	| { loginHint: string; type: 'service_auth' }
	| {
			assertion: string;
			assertionType: typeof AGENT_IDENTITY_ASSERTION_TYPE;
			type: 'identity_assertion';
	  };

export type StartAgentRegistrationResult =
	| { error: string; message?: string; status: 400 | 401 | 403 }
	| {
			assertionExpires: number;
			claim?: ReturnType<typeof ceremony>;
			claimToken?: string;
			claimTokenExpires?: number;
			identityAssertion?: string;
			preClaimScopes?: string[];
			postClaimScopes: string[];
			registrationId: string;
			registrationType: AgentIdentityRegistrationKind;
			status: 200;
	  };

export const startAgentRegistration = async (
	config: AgentAuthConfig,
	input: StartAgentRegistrationInput,
	now = Date.now()
): Promise<StartAgentRegistrationResult> => {
	const registration = requiredRegistration(config);
	const agentId = `agent_${crypto.randomUUID()}`;
	if (input.type === 'anonymous') {
		if (registration.allowAnonymous !== true) {
			return { error: 'anonymous_not_enabled', status: 403 };
		}
		if (registration.revokeAccessTokens === undefined) {
			throw new Error(
				'Anonymous agent registration requires revokeAccessTokens'
			);
		}
		const created = await createFlow({
			agentId,
			kind: 'anonymous',
			now,
			registration,
			status: 'pending'
		});
		await activateAgent(
			config,
			created.flow,
			registration.preClaimScopes ?? []
		);
		const assertion = await issueAgentServiceAssertion(
			config,
			created.flow,
			now
		);

		return {
			assertionExpires: assertion.expiresAt,
			claimToken: created.claimToken,
			claimTokenExpires: created.flow.claimExpiresAt,
			identityAssertion: assertion.assertion,
			postClaimScopes: registration.postClaimScopes,
			preClaimScopes: registration.preClaimScopes ?? [],
			registrationId: created.flow.registrationId,
			registrationType: 'anonymous',
			status: 200
		};
	}

	if (input.type === 'service_auth') {
		if (registration.allowServiceAuth !== true) {
			return { error: 'service_auth_not_enabled', status: 403 };
		}
		const email = input.loginHint.trim().toLowerCase();
		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) {
			return { error: 'invalid_login_hint', status: 400 };
		}
		const created = await createFlow({
			agentId,
			kind: 'service_auth',
			loginHint: email,
			now,
			registration,
			status: 'pending',
			withAttempt: email
		});
		if (created.attempt === undefined)
			throw new Error('Claim attempt missing');

		return {
			assertionExpires: 0,
			claim: ceremony(config, created.flow, created.attempt),
			claimToken: created.claimToken,
			claimTokenExpires: created.flow.claimExpiresAt,
			postClaimScopes: registration.postClaimScopes,
			registrationId: created.flow.registrationId,
			registrationType: 'service_auth',
			status: 200
		};
	}

	if (
		input.assertionType !== AGENT_IDENTITY_ASSERTION_TYPE ||
		registration.verifyIdentityAssertion === undefined
	) {
		return { error: 'invalid_request', status: 400 };
	}
	const identity = await registration.verifyIdentityAssertion(
		input.assertion
	);
	if (identity === undefined) {
		return { error: 'invalid_identity_assertion', status: 401 };
	}
	const authAge = now - identity.authenticatedAt;
	if (
		authAge < -MILLISECONDS_IN_A_MINUTE ||
		authAge >
			(registration.maxAuthenticationAgeMs ?? DEFAULT_MAX_AUTH_AGE_MS)
	) {
		return { error: 'login_required', status: 401 };
	}
	if (
		identity.emailVerified !== true &&
		identity.phoneNumberVerified !== true
	) {
		return { error: 'missing_verified_identity', status: 403 };
	}
	const existing = await registration.identityStore.findByUpstreamIdentity({
		clientId: identity.clientId,
		issuer: identity.issuer,
		subject: identity.subject
	});
	if (existing?.status === 'claimed') {
		const assertion = await issueAgentServiceAssertion(
			config,
			existing,
			now
		);

		return {
			assertionExpires: assertion.expiresAt,
			identityAssertion: assertion.assertion,
			postClaimScopes: registration.postClaimScopes,
			registrationId: existing.registrationId,
			registrationType: 'identity_assertion',
			status: 200
		};
	}
	const match = await registration.resolveVerifiedIdentity?.(identity);
	const verifiedEmail =
		identity.emailVerified === true ? identity.email : undefined;
	if (match?.userId === undefined && verifiedEmail === undefined) {
		return { error: 'interaction_required', status: 401 };
	}
	const created = await createFlow({
		agentId,
		kind: 'identity_assertion',
		now,
		registration,
		status: match?.userId === undefined ? 'pending' : 'claimed',
		upstream: {
			clientId: identity.clientId,
			issuer: identity.issuer,
			subject: identity.subject
		},
		userId: match?.userId,
		withAttempt: match?.userId === undefined ? verifiedEmail : undefined
	});
	if (match?.userId === undefined) {
		if (created.attempt === undefined)
			throw new Error('Claim attempt missing');

		return {
			assertionExpires: 0,
			claim: ceremony(config, created.flow, created.attempt),
			claimToken: created.claimToken,
			claimTokenExpires: created.flow.claimExpiresAt,
			postClaimScopes: registration.postClaimScopes,
			registrationId: created.flow.registrationId,
			registrationType: 'identity_assertion',
			status: 200
		};
	}
	await activateAgent(config, created.flow, registration.postClaimScopes);
	const assertion = await issueAgentServiceAssertion(
		config,
		created.flow,
		now
	);

	return {
		assertionExpires: assertion.expiresAt,
		identityAssertion: assertion.assertion,
		postClaimScopes: registration.postClaimScopes,
		registrationId: created.flow.registrationId,
		registrationType: 'identity_assertion',
		status: 200
	};
};

export type BeginAgentClaimResult =
	| { error: 'claim_expired' | 'invalid_claim_token'; status: 400 }
	| { error: 'concurrent_update'; status: 409 }
	| {
			claimAttempt: ReturnType<typeof ceremony>;
			status: 200;
	  };

export const beginAgentClaim = async (
	config: AgentAuthConfig,
	input: { claimToken: string; email: string },
	now = Date.now()
): Promise<BeginAgentClaimResult> => {
	const registration = requiredRegistration(config);
	const email = input.email.trim().toLowerCase();
	const claimTokenHash = await hashToken(input.claimToken);
	for (let retry = 0; retry < MAX_CONCURRENT_UPDATE_RETRIES; retry += 1) {
		const flow =
			await registration.identityStore.findByClaimTokenHash(
				claimTokenHash
			);
		if (flow === undefined) {
			return { error: 'invalid_claim_token', status: 400 };
		}
		if (flow.claimExpiresAt <= now || flow.status === 'revoked') {
			return { error: 'claim_expired', status: 400 };
		}
		if (flow.loginHint !== undefined && flow.loginHint !== email) {
			return { error: 'invalid_claim_token', status: 400 };
		}
		const attempt = await makeAttempt({ email, now, registration });
		const replacement: AgentIdentityRegistration = {
			...flow,
			claimAttempt: attempt.attempt,
			loginHint: email,
			updatedAt: now
		};
		if (
			await registration.identityStore.replace(replacement, flow.version)
		) {
			return {
				claimAttempt: ceremony(config, replacement, attempt),
				status: 200
			};
		}
	}

	return { error: 'concurrent_update', status: 409 };
};

export type CompleteAgentClaimResult =
	| {
			error:
				| 'claim_expired'
				| 'concurrent_update'
				| 'invalid_claim_attempt'
				| 'user_code_invalid'
				| 'wrong_user';
			status: 400 | 403 | 409 | 429;
	  }
	| { status: 204 };

export const completeAgentClaim = async (
	config: AgentAuthConfig,
	input: {
		attemptToken: string;
		request: Request;
		userCode: string;
	},
	now = Date.now()
): Promise<CompleteAgentClaimResult> => {
	const registration = requiredRegistration(config);
	const user = await registration.resolveAuthenticatedUser(input.request);
	if (user === undefined) return { error: 'wrong_user', status: 403 };
	const attemptTokenHash = await hashToken(input.attemptToken);
	const userCodeHash = await hashToken(input.userCode);
	for (let retry = 0; retry < MAX_CONCURRENT_UPDATE_RETRIES; retry += 1) {
		const flow =
			await registration.identityStore.findByAttemptTokenHash(
				attemptTokenHash
			);
		const attempt = flow?.claimAttempt;
		if (flow === undefined || attempt === undefined) {
			return { error: 'invalid_claim_attempt', status: 400 };
		}
		if (flow.claimExpiresAt <= now || attempt.expiresAt <= now) {
			return { error: 'claim_expired', status: 400 };
		}
		if (user.email?.toLowerCase() !== attempt.email) {
			return { error: 'wrong_user', status: 403 };
		}
		const matches = await constantTimeEqual(
			userCodeHash,
			attempt.userCodeHash
		);
		if (!matches) {
			const attempts = attempt.attempts + 1;
			const locked =
				attempts >=
				(registration.maxCodeAttempts ?? DEFAULT_MAX_CODE_ATTEMPTS);
			const replaced = await registration.identityStore.replace(
				{
					...flow,
					claimAttempt: locked ? undefined : { ...attempt, attempts },
					updatedAt: now
				},
				flow.version
			);
			if (replaced) {
				return {
					error: 'user_code_invalid',
					status: locked ? 429 : 400
				};
			}
			continue;
		}
		if (flow.kind === 'anonymous') {
			// Implementations must make this callback idempotent: a CAS conflict
			// may require retrying it before the claimed state is committed.
			await registration.revokeAccessTokens?.(flow.agentId);
		}
		const replacement: AgentIdentityRegistration = {
			...flow,
			claimAttempt: undefined,
			status: 'claimed',
			updatedAt: now,
			userId: user.userId
		};
		if (
			!(await registration.identityStore.replace(
				replacement,
				flow.version
			))
		) {
			continue;
		}
		const persisted = await registration.identityStore.findByRegistrationId(
			flow.registrationId
		);
		if (persisted === undefined) {
			throw new Error('Completed agent registration disappeared');
		}
		await activateAgent(config, persisted, registration.postClaimScopes);

		return { status: 204 };
	}

	return { error: 'concurrent_update', status: 409 };
};

export type AgentTokenGrantResult =
	| { body: Record<string, unknown>; status: 200 }
	| { body: { error: string }; status: 400 };

const issueAgentAccessToken = async (
	config: AgentAuthConfig,
	flow: AgentIdentityRegistration,
	now: number
) => {
	const registration = requiredRegistration(config);
	const accessToken = `at_${generateSecureToken(TOKEN_BYTES)}`;
	const scopes = (
		flow.status === 'claimed'
			? registration.postClaimScopes
			: (registration.preClaimScopes ?? [])
	).filter((scope) => config.scopes.includes(scope));
	const expiresAt =
		now + (registration.tokenTtlMs ?? DEFAULT_ACCESS_TOKEN_TTL_MS);
	await registration.accessTokenStore.saveToken({
		clientId: flow.agentId,
		createdAt: now,
		expiresAt,
		hashedToken: await hashToken(accessToken),
		ownerId: flow.userId,
		scopes,
		tokenId: crypto.randomUUID()
	});

	return {
		accessToken,
		expiresIn: Math.floor((expiresAt - now) / MILLISECONDS_IN_A_SECOND),
		scopes
	};
};

export const createAgentRegistrationCredentialVerifier =
	(
		accessTokenStore: AccessTokenStore,
		identityStore?: AgentIdentityRegistrationStore
	) =>
	async (request: Request) => {
		const authorization = request.headers.get('authorization');
		if (authorization?.startsWith('Bearer at_') !== true) return undefined;
		const token = authorization.slice('Bearer '.length).trim();
		const record = await accessTokenStore.findByHashedToken(
			await hashToken(token)
		);
		if (record === undefined || record.expiresAt <= Date.now())
			return undefined;
		if (identityStore !== undefined) {
			const identity = await identityStore.findByAgentId(record.clientId);
			if (identity === undefined || identity.status === 'revoked') {
				return undefined;
			}
		}

		return {
			agentId: record.clientId,
			expiresAt: record.expiresAt,
			scopes: record.scopes,
			userId: record.ownerId
		};
	};
export const handleAgentTokenGrant = async (
	config: AgentAuthConfig,
	body: Record<string, string | undefined>,
	now = Date.now()
): Promise<AgentTokenGrantResult | undefined> => {
	const registration = requiredRegistration(config);
	if (body.grant_type === AGENT_CLAIM_GRANT_TYPE) {
		if (body.claim_token === undefined) {
			return { body: { error: 'invalid_request' }, status: 400 };
		}
		const claimTokenHash = await hashToken(body.claim_token);
		let flow: AgentIdentityRegistration | undefined;
		for (let retry = 0; retry < MAX_CONCURRENT_UPDATE_RETRIES; retry += 1) {
			flow =
				await registration.identityStore.findByClaimTokenHash(
					claimTokenHash
				);
			if (flow === undefined || flow.claimExpiresAt <= now) {
				return { body: { error: 'expired_token' }, status: 400 };
			}
			if (flow.status === 'claimed') break;
			if (
				flow.claimAttempt !== undefined &&
				flow.claimAttempt.expiresAt <= now
			) {
				return { body: { error: 'expired_token' }, status: 400 };
			}
			const intervalMs =
				(registration.pollIntervalSeconds ??
					DEFAULT_POLL_INTERVAL_SECONDS) * MILLISECONDS_IN_A_SECOND;
			if (
				flow.lastPolledAt !== undefined &&
				now - flow.lastPolledAt < intervalMs
			) {
				return { body: { error: 'slow_down' }, status: 400 };
			}
			if (
				await registration.identityStore.replace(
					{ ...flow, lastPolledAt: now, updatedAt: now },
					flow.version
				)
			) {
				return {
					body: { error: 'authorization_pending' },
					status: 400
				};
			}
		}
		if (flow?.status !== 'claimed') {
			return { body: { error: 'temporarily_unavailable' }, status: 400 };
		}
		const assertion = await issueAgentServiceAssertion(config, flow, now);
		const token = await issueAgentAccessToken(config, flow, now);

		return {
			body: {
				access_token: token.accessToken,
				assertion_expires: new Date(assertion.expiresAt).toISOString(),
				expires_in: token.expiresIn,
				identity_assertion: assertion.assertion,
				scope: token.scopes.join(' '),
				token_type: 'Bearer'
			},
			status: 200
		};
	}
	if (body.grant_type !== AGENT_IDENTITY_ASSERTION_GRANT_TYPE) {
		return undefined;
	}
	if (body.assertion === undefined) {
		return { body: { error: 'invalid_request' }, status: 400 };
	}
	const verified = await verifyJwt(
		body.assertion,
		registration.signingKey.publicJwk
	);
	const payload = verified?.payload;
	if (
		verified?.header?.typ !== 'oauth-id-jag+jwt' ||
		payload?.iss !== config.authorizationServer ||
		payload.aud !== config.authorizationServer ||
		typeof payload.sub !== 'string' ||
		typeof payload.exp !== 'number' ||
		payload.exp <= Math.floor(now / MILLISECONDS_IN_A_SECOND)
	) {
		return { body: { error: 'invalid_grant' }, status: 400 };
	}
	const flow = await registration.identityStore.findByRegistrationId(
		payload.sub
	);
	if (
		flow === undefined ||
		flow.status === 'revoked' ||
		payload.registration_version !== flow.version
	) {
		return { body: { error: 'invalid_grant' }, status: 400 };
	}
	const token = await issueAgentAccessToken(config, flow, now);

	return {
		body: {
			access_token: token.accessToken,
			expires_in: token.expiresIn,
			scope: token.scopes.join(' '),
			token_type: 'Bearer'
		},
		status: 200
	};
};
export const revokeAgentIdentityRegistration = async (
	config: AgentAuthConfig,
	registrationId: string,
	now = Date.now()
) => {
	const registration = requiredRegistration(config);
	for (let retry = 0; retry < MAX_CONCURRENT_UPDATE_RETRIES; retry += 1) {
		const flow =
			await registration.identityStore.findByRegistrationId(
				registrationId
			);
		if (flow === undefined) return false;
		if (flow.status === 'revoked') return true;
		await registration.revokeAccessTokens?.(flow.agentId);
		if (
			await registration.identityStore.replace(
				{
					...flow,
					claimAttempt: undefined,
					status: 'revoked',
					updatedAt: now
				},
				flow.version
			)
		) {
			return true;
		}
	}

	throw new Error('Could not revoke agent identity after concurrent updates');
};
