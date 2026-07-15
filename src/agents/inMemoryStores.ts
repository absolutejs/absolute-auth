import type {
	AgentDelegation,
	AgentDelegationStore,
	AgentRegistration,
	AgentRegistrationStore
} from './types';

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
