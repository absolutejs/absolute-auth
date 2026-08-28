import type { RouteString } from '../types';
import type {
	AgentCredentialVerifier,
	AgentDelegationStore,
	AgentRegistrationStore
} from './types';
import type { AgentRegistrationProtocolConfig } from './registration';
import type { AgentOAuthGuideConfig } from './oauthGuide';

export const DEFAULT_AGENT_RESOURCE_METADATA_ROUTE: RouteString =
	'/.well-known/oauth-protected-resource';

export type AgentRegistrationDiscoveryMetadata = {
	claim_endpoint: string;
	identity_assertion: { assertion_types_supported: string[] };
	identity_endpoint: string;
	identity_types_supported: string[];
	skill: string;
};

export type AgentAuthConfig = {
	/** Permit registered agents to authenticate without a user delegation. Secure
	 * default is false; enable for machine-only resources. */
	allowUndelegated?: boolean;
	/** Open auth.md agent-registration support. Implemented natively by Absolute
	 * Auth and projected through OAuth discovery; no WorkOS service is required. */
	agentRegistration?: AgentRegistrationProtocolConfig;
	/** Agent-readable OAuth onboarding derived from the same protected resources
	 * and scopes the application actually enables. This is separate from the
	 * optional claim/ID-JAG registration profile. */
	oauthGuide?: AgentOAuthGuideConfig;
	authorizationServer: string;
	delegationStore: AgentDelegationStore;
	/** Advertise RFC 9728 `dpop_bound_access_tokens_required`. Keep this aligned
	 * with a credential verifier configured with `requireDpop: true`. */
	dpopBoundAccessTokensRequired?: boolean;
	logoUri?: string;
	metadataRoute?: RouteString;
	/** Authorization-server route prefix. Defaults to `/oauth2`; used to derive
	 * the authoritative token endpoint advertised by the generated guide. */
	oidcRoute?: RouteString;
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
		| 'dpopBoundAccessTokensRequired'
		| 'logoUri'
		| 'resource'
		| 'resourceName'
		| 'scopes'
	>
) => ({
	authorization_servers: [config.authorizationServer],
	bearer_methods_supported: ['header'],
	...(config.dpopBoundAccessTokensRequired === true
		? { dpop_bound_access_tokens_required: true }
		: {}),
	...(config.logoUri === undefined
		? {}
		: { resource_logo_uri: config.logoUri }),
	...(config.resourceName === undefined
		? {}
		: { resource_name: config.resourceName }),
	resource: config.resource,
	scopes_supported: config.scopes
});
