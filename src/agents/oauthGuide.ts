import type { RouteString } from '../types';

export type AgentOAuthGuideResource = {
	metadataUrl: string;
	name: string;
	resource: string;
	scopes: readonly string[];
};

export type AgentOAuthGuideConfig = {
	authorizationServer: string;
	resources: readonly AgentOAuthGuideResource[];
	route?: RouteString;
	serviceName: string;
};

const DEFAULT_GUIDE_ROUTE: RouteString = '/auth.md';

const secureUrl = (value: string, label: string) => {
	const url = new URL(value);
	const loopback =
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' || url.hostname === '127.0.0.1');
	if (url.protocol !== 'https:' && !loopback)
		throw new Error(`${label} must use HTTPS outside loopback development`);
	if (url.username || url.password || url.hash)
		throw new Error(`${label} cannot contain credentials or a fragment`);

	return url.toString();
};

export const agentOAuthGuideRoute = (config: AgentOAuthGuideConfig) =>
	config.route ?? DEFAULT_GUIDE_ROUTE;

export const agentOAuthGuideUrl = (config: AgentOAuthGuideConfig) =>
	new URL(
		agentOAuthGuideRoute(config),
		secureUrl(config.authorizationServer, 'OAuth authorization server')
	).toString();

const normalizedResources = (config: AgentOAuthGuideConfig) => {
	if (config.resources.length === 0)
		throw new Error('Agent OAuth guide requires at least one resource');
	const resources = config.resources.map((resource) => ({
		metadataUrl: secureUrl(
			resource.metadataUrl,
			'Protected-resource metadata URL'
		),
		name: resource.name.trim(),
		resource: secureUrl(resource.resource, 'OAuth protected resource'),
		scopes: [
			...new Set(resource.scopes.map((scope) => scope.trim()))
		].filter(Boolean)
	}));
	if (resources.some(({ name, scopes }) => !name || scopes.length === 0))
		throw new Error(
			'Every agent OAuth guide resource requires a name and at least one scope'
		);
	if (
		new Set(resources.map(({ resource }) => resource)).size !==
		resources.length
	)
		throw new Error('Agent OAuth guide resources must be unique');

	return resources;
};

const resourceSections = (resources: ReturnType<typeof normalizedResources>) =>
	resources
		.map(
			(resource) => `### ${resource.name}

- Protected resource: \`${resource.resource}\`
- Metadata: ${resource.metadataUrl}
- Allowed scopes: ${resource.scopes.map((scope) => `\`${scope}\``).join(', ')}
`
		)
		.join('\n');

/** Generate an agent-readable OAuth companion from exact application-owned
 * resource metadata. OAuth discovery remains authoritative. */
export const generateAgentOAuthGuide = (config: AgentOAuthGuideConfig) => {
	if (!config.serviceName.trim())
		throw new Error('Agent OAuth guide requires a service name');
	const authorizationServer = secureUrl(
		config.authorizationServer,
		'OAuth authorization server'
	);
	const resources = normalizedResources(config);
	const authorizationMetadata = new URL(
		'/.well-known/oauth-authorization-server',
		authorizationServer
	).toString();

	return `# OAuth access for ${config.serviceName.trim()}

This guide is the agent-readable companion to the service's standards-based
OAuth metadata. Discovery metadata is authoritative. Do not infer endpoints,
scopes, audiences, or capabilities that are not advertised.

## 1. Discover

Fetch the protected-resource metadata for the exact interface you intend to
use, then fetch the authorization-server metadata at
${authorizationMetadata}.

${resourceSections(resources)}
## 2. Register the OAuth client

Use an existing registered client or the advertised \`registration_endpoint\`.
Request only scopes listed for the selected protected resource. Never register
redirect URIs, grant types, or authentication methods the metadata rejects.

## 3. Obtain user delegation

For an interactive user, use authorization code with PKCE. For a device or
headless client, use the device authorization grant only when
\`device_authorization_endpoint\` is advertised. Send the selected protected
resource as the OAuth \`resource\` value and show the exact requested scopes to
the user before consent.

## 4. Call the selected interface

Present the access token in the Authorization header. The token must name the
selected resource as its audience and contain the required scope. A token for
one resource or transport is not authority for another.

## Safety

- Never ask a user to send a password, passkey response, MFA code, device code,
  authorization code, client secret, refresh token, or access token to the
  agent or place one in model context.
- Stop on issuer, signature, audience, expiry, delegation, or scope failure.
- Treat consent denial, revocation, and disabled interfaces as final until the
  user explicitly starts a new authorization flow.
- Discovery is not authorization, and this guide grants no capability by
  itself.
`;
};
