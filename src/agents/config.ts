import type { RouteString } from '../types';
import type {
	AgentCredentialVerifier,
	AgentDelegationStore,
	AgentRegistrationStore
} from './types';

export const DEFAULT_AGENT_RESOURCE_METADATA_ROUTE: RouteString =
	'/.well-known/oauth-protected-resource';

export type AgentAuthConfig = {
	/** Permit registered agents to authenticate without a user delegation. Secure
	 * default is false; enable for machine-only resources. */
	allowUndelegated?: boolean;
	authorizationServer: string;
	delegationStore: AgentDelegationStore;
	logoUri?: string;
	metadataRoute?: RouteString;
	registrationStore: AgentRegistrationStore;
	/** Treat clients created through RFC 7591 DCR as agent registrations. Explicitly
	 * opt-in because a deployment may also use DCR for ordinary relying parties. */
	registerDynamicClients?: boolean;
	resource: string;
	resourceName?: string;
	scopes: string[];
	verifyCredential: AgentCredentialVerifier;
};

export const agentProtectedResourceMetadata = (
	config: Pick<
		AgentAuthConfig,
		| 'authorizationServer'
		| 'logoUri'
		| 'resource'
		| 'resourceName'
		| 'scopes'
	>
) => ({
	authorization_servers: [config.authorizationServer],
	bearer_methods_supported: ['header'],
	...(config.logoUri === undefined
		? {}
		: { resource_logo_uri: config.logoUri }),
	...(config.resourceName === undefined
		? {}
		: { resource_name: config.resourceName }),
	resource: config.resource,
	scopes_supported: config.scopes
});
