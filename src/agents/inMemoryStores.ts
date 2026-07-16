import type {
	AgentDelegation,
	AgentDelegationStore,
	AgentIdentityRegistration,
	AgentIdentityRegistrationStore,
	AgentRegistration,
	AgentRegistrationStore
} from './types';

const cloneIdentityRegistration = (
	value: AgentIdentityRegistration
): AgentIdentityRegistration => ({
	...value,
	claimAttempt:
		value.claimAttempt === undefined
			? undefined
			: { ...value.claimAttempt },
	upstream: value.upstream === undefined ? undefined : { ...value.upstream }
});

const cloneRegistration = (value: AgentRegistration): AgentRegistration => ({
	...value,
	allowedScopes: [...value.allowedScopes],
	metadata: value.metadata === undefined ? undefined : { ...value.metadata }
});

const cloneDelegation = (value: AgentDelegation): AgentDelegation => ({
	...value,
	authorizationDetails: value.authorizationDetails?.map((entry) => ({
		...entry
	})),
	scopes: [...value.scopes]
});

export const createInMemoryAgentDelegationStore = (): AgentDelegationStore => {
	const delegations = new Map<string, AgentDelegation>();

	return {
		findActiveDelegation: async ({
			agentId,
			now = Date.now(),
			organizationId,
			userId
		}) => {
			const value = [...delegations.values()].find(
				(delegation) =>
					delegation.agentId === agentId &&
					delegation.userId === userId &&
					delegation.organizationId === organizationId &&
					delegation.status === 'active' &&
					(delegation.expiresAt === undefined ||
						delegation.expiresAt > now)
			);

			return value === undefined ? undefined : cloneDelegation(value);
		},
		findByDelegationId: async (delegationId) => {
			const value = delegations.get(delegationId);

			return value === undefined ? undefined : cloneDelegation(value);
		},
		listDelegations: async (agentId) =>
			[...delegations.values()]
				.filter(
					(delegation) =>
						agentId === undefined || delegation.agentId === agentId
				)
				.sort((left, right) => right.createdAt - left.createdAt)
				.map(cloneDelegation),
		saveDelegation: async (delegation) => {
			delegations.set(
				delegation.delegationId,
				cloneDelegation(delegation)
			);
		}
	};
};
export const createInMemoryAgentIdentityRegistrationStore =
	(): AgentIdentityRegistrationStore => {
		const registrations = new Map<string, AgentIdentityRegistration>();

		return {
			create: async (registration) => {
				const conflicts = [...registrations.values()].some(
					(existing) =>
						existing.registrationId ===
							registration.registrationId ||
						existing.agentId === registration.agentId ||
						existing.claimTokenHash ===
							registration.claimTokenHash ||
						(existing.claimAttempt !== undefined &&
							existing.claimAttempt.tokenHash ===
								registration.claimAttempt?.tokenHash) ||
						(existing.upstream !== undefined &&
							registration.upstream !== undefined &&
							existing.upstream.clientId ===
								registration.upstream.clientId &&
							existing.upstream.issuer ===
								registration.upstream.issuer &&
							existing.upstream.subject ===
								registration.upstream.subject)
				);
				if (conflicts) return false;
				registrations.set(
					registration.registrationId,
					cloneIdentityRegistration(registration)
				);

				return true;
			},
			findByAgentId: async (agentId) => {
				const value = [...registrations.values()].find(
					(registration) => registration.agentId === agentId
				);

				return value === undefined
					? undefined
					: cloneIdentityRegistration(value);
			},
			findByAttemptTokenHash: async (attemptTokenHash) => {
				const value = [...registrations.values()].find(
					(registration) =>
						registration.claimAttempt?.tokenHash ===
						attemptTokenHash
				);

				return value === undefined
					? undefined
					: cloneIdentityRegistration(value);
			},
			findByClaimTokenHash: async (claimTokenHash) => {
				const value = [...registrations.values()].find(
					(registration) =>
						registration.claimTokenHash === claimTokenHash
				);

				return value === undefined
					? undefined
					: cloneIdentityRegistration(value);
			},
			findByRegistrationId: async (registrationId) => {
				const value = registrations.get(registrationId);

				return value === undefined
					? undefined
					: cloneIdentityRegistration(value);
			},
			findByUpstreamIdentity: async ({ clientId, issuer, subject }) => {
				const value = [...registrations.values()].find(
					(registration) =>
						registration.upstream?.clientId === clientId &&
						registration.upstream?.issuer === issuer &&
						registration.upstream.subject === subject
				);

				return value === undefined
					? undefined
					: cloneIdentityRegistration(value);
			},
			replace: async (registration, expectedVersion) => {
				const current = registrations.get(registration.registrationId);
				if (current?.version !== expectedVersion) return false;
				registrations.set(
					registration.registrationId,
					cloneIdentityRegistration({
						...registration,
						version: expectedVersion + 1
					})
				);

				return true;
			}
		};
	};
export const createInMemoryAgentRegistrationStore =
	(): AgentRegistrationStore => {
		const registrations = new Map<string, AgentRegistration>();

		return {
			findByAgentId: async (agentId) => {
				const value = registrations.get(agentId);

				return value === undefined
					? undefined
					: cloneRegistration(value);
			},
			findByClientId: async (clientId) => {
				const value = [...registrations.values()].find(
					(registration) => registration.clientId === clientId
				);

				return value === undefined
					? undefined
					: cloneRegistration(value);
			},
			listRegistrations: async () =>
				[...registrations.values()]
					.sort((left, right) => right.createdAt - left.createdAt)
					.map(cloneRegistration),
			saveRegistration: async (registration) => {
				registrations.set(
					registration.agentId,
					cloneRegistration(registration)
				);
			}
		};
	};
