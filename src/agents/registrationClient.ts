import {
	AGENT_CLAIM_GRANT_TYPE,
	AGENT_IDENTITY_ASSERTION_GRANT_TYPE,
	AGENT_IDENTITY_ASSERTION_TYPE
} from './registration';

type JsonObject = Record<string, unknown>;

export type DiscoveredAgentRegistration = {
	agentAuth: {
		claimEndpoint: string;
		identityAssertionTypes: string[];
		identityEndpoint: string;
		identityTypes: string[];
		skill: string;
	};
	authorizationServer: string;
	resource: string;
	resourceMetadataUrl: string;
	scopes: string[];
	tokenEndpoint: string;
};

export type AgentRegistrationClientOptions = {
	allowInsecureLocalhost?: boolean;
	maxResponseBytes?: number;
	request?: typeof fetch;
};

const isObject = (value: unknown): value is JsonObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const secureUrl = (value: unknown, allowLocalhost: boolean) => {
	if (typeof value !== 'string') return undefined;
	try {
		const url = new URL(value);
		if (url.protocol === 'https:') return url.toString();
		if (
			allowLocalhost &&
			url.protocol === 'http:' &&
			(url.hostname === 'localhost' || url.hostname === '127.0.0.1')
		) {
			return url.toString();
		}
	} catch {
		return undefined;
	}

	return undefined;
};

const readBoundedJson = async (response: Response, maxBytes: number) => {
	const length = Number(response.headers.get('content-length'));
	if (Number.isFinite(length) && length > maxBytes) {
		throw new Error(
			'Agent registration metadata exceeds the response limit'
		);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > maxBytes) {
		throw new Error(
			'Agent registration metadata exceeds the response limit'
		);
	}

	const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

	return parsed;
};

const stringArray = (value: unknown) =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: [];

const requestJson = async (
	request: typeof fetch,
	url: string,
	init: RequestInit,
	maxBytes: number
) => {
	const response = await request(url, {
		...init,
		headers: {
			accept: 'application/json',
			...init.headers
		},
		redirect: 'error'
	});
	const body = await readBoundedJson(response, maxBytes);
	if (!isObject(body)) throw new Error('Expected a JSON object');

	return { body, response };
};

/** Discovers agent registration using RFC 9728 followed by RFC 8414. Network
 * policy is injected through `request`; redirects are rejected by default. */
export const createAgentRegistrationClient = (
	discovery: DiscoveredAgentRegistration,
	options: AgentRegistrationClientOptions = {}
) => {
	const request = options.request ?? fetch;
	const maxBytes = options.maxResponseBytes ?? 256 * 1024;
	const post = (url: string, body: JsonObject, form = false) =>
		requestJson(
			request,
			url,
			{
				body: form
					? new URLSearchParams(
							Object.fromEntries(
								Object.entries(body).map(([key, value]) => [
									key,
									String(value)
								])
							)
						)
					: JSON.stringify(body),
				headers: {
					'content-type': form
						? 'application/x-www-form-urlencoded'
						: 'application/json'
				},
				method: 'POST'
			},
			maxBytes
		);

	return {
		beginAnonymous: () =>
			post(discovery.agentAuth.identityEndpoint, { type: 'anonymous' }),
		beginServiceAuth: (loginHint: string) =>
			post(discovery.agentAuth.identityEndpoint, {
				login_hint: loginHint,
				type: 'service_auth'
			}),
		beginVerified: (assertion: string) => {
			if (
				!discovery.agentAuth.identityAssertionTypes.includes(
					AGENT_IDENTITY_ASSERTION_TYPE
				)
			) {
				throw new Error('Service does not accept ID-JAG assertions');
			}

			return post(discovery.agentAuth.identityEndpoint, {
				assertion,
				assertion_type: AGENT_IDENTITY_ASSERTION_TYPE,
				type: 'identity_assertion'
			});
		},
		claim: (claimToken: string, email: string) =>
			post(discovery.agentAuth.claimEndpoint, {
				claim_token: claimToken,
				email
			}),
		exchangeAssertion: (assertion: string) =>
			post(
				discovery.tokenEndpoint,
				{
					assertion,
					grant_type: AGENT_IDENTITY_ASSERTION_GRANT_TYPE,
					resource: discovery.resource
				},
				true
			),
		pollClaim: (claimToken: string) =>
			post(
				discovery.tokenEndpoint,
				{
					claim_token: claimToken,
					grant_type: AGENT_CLAIM_GRANT_TYPE
				},
				true
			)
	};
};
export const discoverAgentRegistration = async (
	resource: string,
	options: AgentRegistrationClientOptions = {}
): Promise<DiscoveredAgentRegistration> => {
	const request = options.request ?? fetch;
	const maxBytes = options.maxResponseBytes ?? 256 * 1024;
	const allowLocalhost = options.allowInsecureLocalhost === true;
	const resourceUrl = secureUrl(resource, allowLocalhost);
	if (resourceUrl === undefined)
		throw new Error('Resource URL must use HTTPS');
	const resourceMetadataUrl = new URL(
		'/.well-known/oauth-protected-resource',
		resourceUrl
	).toString();
	const prm = await requestJson(request, resourceMetadataUrl, {}, maxBytes);
	const advertisedResource = secureUrl(prm.body.resource, allowLocalhost);
	if (
		advertisedResource === undefined ||
		advertisedResource !== resourceUrl
	) {
		throw new Error('Protected resource metadata identity mismatch');
	}
	const authorizationServer = secureUrl(
		stringArray(prm.body.authorization_servers)[0],
		allowLocalhost
	);
	if (authorizationServer === undefined) {
		throw new Error('No secure authorization server is advertised');
	}
	const asUrl = new URL(
		'/.well-known/oauth-authorization-server',
		authorizationServer
	).toString();
	const metadata = await requestJson(request, asUrl, {}, maxBytes);
	if (
		secureUrl(metadata.body.issuer, allowLocalhost) !== authorizationServer
	) {
		throw new Error('Authorization server issuer mismatch');
	}
	const tokenEndpoint = secureUrl(
		metadata.body.token_endpoint,
		allowLocalhost
	);
	const agentAuth = metadata.body.agent_auth;
	if (tokenEndpoint === undefined || !isObject(agentAuth)) {
		throw new Error(
			'Authorization server does not advertise agent registration'
		);
	}
	const identityEndpoint = secureUrl(
		agentAuth.identity_endpoint,
		allowLocalhost
	);
	const claimEndpoint = secureUrl(agentAuth.claim_endpoint, allowLocalhost);
	const skill = secureUrl(agentAuth.skill, allowLocalhost);
	const assertionMetadata = agentAuth.identity_assertion;
	if (
		identityEndpoint === undefined ||
		claimEndpoint === undefined ||
		skill === undefined ||
		!isObject(assertionMetadata)
	) {
		throw new Error('Agent registration metadata is incomplete');
	}

	return {
		agentAuth: {
			claimEndpoint,
			identityAssertionTypes: stringArray(
				assertionMetadata.assertion_types_supported
			),
			identityEndpoint,
			identityTypes: stringArray(agentAuth.identity_types_supported),
			skill
		},
		authorizationServer,
		resource: resourceUrl,
		resourceMetadataUrl,
		scopes: stringArray(prm.body.scopes_supported),
		tokenEndpoint
	};
};
