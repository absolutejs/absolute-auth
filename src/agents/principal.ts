import type { AgentAuthConfig } from './config';
import type { AgentPrincipal } from './types';

const intersectScopes = (...sets: string[][]) => {
	if (sets.length === 0) return [];
	const [first = [], ...rest] = sets;

	return [...new Set(first)].filter((scope) =>
		rest.every((set) => set.includes(scope))
	);
};

export const agentHasScopes = (
	principal: AgentPrincipal | undefined,
	requiredScopes: string[]
) =>
	principal !== undefined &&
	requiredScopes.every((scope) => principal.scopes.includes(scope));
export const resolveAgentPrincipal = async (
	request: Request,
	config: AgentAuthConfig
): Promise<AgentPrincipal | undefined> => {
	const credential = await config.verifyCredential(request);
	if (credential === undefined) return undefined;
	if (
		credential.resource !== undefined &&
		credential.resource !== config.resource
	) {
		return undefined;
	}
	if (
		credential.expiresAt !== undefined &&
		credential.expiresAt <= Date.now()
	) {
		return undefined;
	}

	const registration = await config.registrationStore.findByAgentId(
		credential.agentId
	);
	if (registration === undefined || registration.status !== 'active') {
		return undefined;
	}

	const registeredScopes = intersectScopes(
		credential.scopes,
		registration.allowedScopes,
		config.scopes
	);
	if (credential.userId === undefined) {
		if (config.allowUndelegated !== true) return undefined;

		return {
			agentId: registration.agentId,
			kind: 'agent',
			name: registration.name,
			scopes: registeredScopes,
			trust: 'registered'
		};
	}

	const delegation = await config.delegationStore.findActiveDelegation({
		agentId: registration.agentId,
		organizationId: credential.organizationId,
		userId: credential.userId
	});
	if (delegation === undefined) return undefined;

	return {
		agentId: registration.agentId,
		authorizationDetails: delegation.authorizationDetails,
		delegationId: delegation.delegationId,
		kind: 'agent',
		name: registration.name,
		organizationId: delegation.organizationId,
		scopes: intersectScopes(registeredScopes, delegation.scopes),
		trust: 'delegated',
		userId: delegation.userId
	};
};
