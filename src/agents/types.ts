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
