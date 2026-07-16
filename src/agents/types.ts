export type AgentRegistrationStatus = 'active' | 'revoked';
export type AgentDelegationStatus = 'active' | 'revoked';

/** A durable identity for an agent client. This is deliberately protocol-neutral:
 * `clientId` can refer to an OAuth client, while adapters for other protocols can
 * use `agentId` without manufacturing OAuth metadata. */
export type AgentRegistration = {
	agentId: string;
	allowedScopes: string[];
	clientId?: string;
	createdAt: number;
	metadata?: Record<string, unknown>;
	name: string;
	status: AgentRegistrationStatus;
	updatedAt: number;
};

export type AgentRegistrationStore = {
	findByAgentId: (agentId: string) => Promise<AgentRegistration | undefined>;
	findByClientId: (
		clientId: string
	) => Promise<AgentRegistration | undefined>;
	listRegistrations: () => Promise<AgentRegistration[]>;
	saveRegistration: (registration: AgentRegistration) => Promise<void>;
};

/** A user's explicit grant to an agent. Authorization details use RFC 9396's
 * open object shape so applications can express transaction constraints without
 * forcing them into coarse OAuth scope strings. */
export type AgentDelegation = {
	agentId: string;
	authorizationDetails?: Record<string, unknown>[];
	createdAt: number;
	delegationId: string;
	expiresAt?: number;
	organizationId?: string;
	scopes: string[];
	status: AgentDelegationStatus;
	updatedAt: number;
	userId: string;
};

export type AgentDelegationStore = {
	findActiveDelegation: (query: {
		agentId: string;
		now?: number;
		organizationId?: string;
		userId: string;
	}) => Promise<AgentDelegation | undefined>;
	findByDelegationId: (
		delegationId: string
	) => Promise<AgentDelegation | undefined>;
	listDelegations: (agentId?: string) => Promise<AgentDelegation[]>;
	saveDelegation: (delegation: AgentDelegation) => Promise<void>;
};

/** The normalized result produced by a wire-protocol adapter. The core never
 * handles raw provider assertions; it authorizes only this verified shape. */
export type VerifiedAgentCredential = {
	agentId: string;
	claims?: Record<string, unknown>;
	expiresAt?: number;
	organizationId?: string;
	resource?: string;
	scopes: string[];
	userId?: string;
};

export type AgentCredentialVerifier = (
	request: Request
) => Promise<VerifiedAgentCredential | undefined>;

export type AgentPrincipal = {
	agentId: string;
	authorizationDetails?: Record<string, unknown>[];
	delegationId?: string;
	kind: 'agent';
	name: string;
	organizationId?: string;
	scopes: string[];
	trust: 'delegated' | 'registered';
	userId?: string;
};

export type AgentIdentityRegistrationKind =
	| 'anonymous'
	| 'identity_assertion'
	| 'service_auth';
export type AgentIdentityRegistrationStatus = 'claimed' | 'pending' | 'revoked';

export type AgentClaimAttempt = {
	attempts: number;
	email: string;
	expiresAt: number;
	tokenHash: string;
	userCodeHash: string;
};

/** Durable state for the open auth.md registration profile. Secrets are
 * represented only by hashes; plaintext claim and attempt tokens are returned
 * once to the agent and never persisted. `version` is used for compare-and-swap
 * updates so claim completion is safe across multiple application instances. */
export type AgentIdentityRegistration = {
	agentId: string;
	claimAttempt?: AgentClaimAttempt;
	claimExpiresAt: number;
	claimTokenHash: string;
	createdAt: number;
	expiresAt: number;
	kind: AgentIdentityRegistrationKind;
	loginHint?: string;
	lastPolledAt?: number;
	registrationId: string;
	status: AgentIdentityRegistrationStatus;
	updatedAt: number;
	upstream?: {
		clientId: string;
		issuer: string;
		subject: string;
	};
	userId?: string;
	version: number;
};

export type AgentIdentityRegistrationStore = {
	create: (registration: AgentIdentityRegistration) => Promise<boolean>;
	findByClaimTokenHash: (
		claimTokenHash: string
	) => Promise<AgentIdentityRegistration | undefined>;
	findByAgentId: (
		agentId: string
	) => Promise<AgentIdentityRegistration | undefined>;
	findByRegistrationId: (
		registrationId: string
	) => Promise<AgentIdentityRegistration | undefined>;
	findByUpstreamIdentity: (query: {
		clientId: string;
		issuer: string;
		subject: string;
	}) => Promise<AgentIdentityRegistration | undefined>;
	findByAttemptTokenHash: (
		attemptTokenHash: string
	) => Promise<AgentIdentityRegistration | undefined>;
	/** Replaces a record only when its current version equals expectedVersion. */
	replace: (
		registration: AgentIdentityRegistration,
		expectedVersion: number
	) => Promise<boolean>;
};

export type VerifiedAgentIdentityAssertion = {
	authenticatedAt: number;
	clientId: string;
	email?: string;
	emailVerified?: boolean;
	issuer: string;
	name?: string;
	phoneNumber?: string;
	phoneNumberVerified?: boolean;
	subject: string;
};
