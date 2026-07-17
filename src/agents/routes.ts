import { Elysia } from 'elysia';
import {
	agentProtectedResourceMetadata,
	DEFAULT_AGENT_RESOURCE_METADATA_ROUTE,
	type AgentAuthConfig
} from './config';
import { agentHasScopes, resolveAgentPrincipal } from './principal';
import type { AgentPrincipal } from './types';
import {
	AGENT_IDENTITY_ASSERTION_TYPE,
	agentRegistrationDiscoveryMetadata,
	beginAgentClaim,
	completeAgentClaim,
	generateAgentRegistrationGuide,
	startAgentRegistration,
	type StartAgentRegistrationInput
} from './registration';

type AgentAuthFailure = {
	code: 'Forbidden' | 'Unauthorized';
	message: 'Agent is not authenticated' | 'Insufficient agent scopes';
};

const DELETE_CODE_POINT = 127;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const MINIMUM_PRINTABLE_CODE_POINT = 32;

const quoteHeaderValue = (value: string) => {
	const printable = [...value]
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;

			return (
				codePoint >= MINIMUM_PRINTABLE_CODE_POINT &&
				codePoint !== DELETE_CODE_POINT
			);
		})
		.join('');

	return `"${printable.replace(/[\\"]/g, '\\$&')}"`;
};

export const agentAuthChallenge = ({
	config,
	error,
	requiredScopes = []
}: {
	config: AgentAuthConfig;
	error?: 'invalid_token' | 'insufficient_scope';
	requiredScopes?: string[];
}) => {
	const parameters = [
		`resource_metadata=${quoteHeaderValue(agentResourceMetadataUrl(config))}`
	];
	if (requiredScopes.length > 0) {
		parameters.push(`scope=${quoteHeaderValue(requiredScopes.join(' '))}`);
	}
	if (error !== undefined) {
		parameters.push(`error=${quoteHeaderValue(error)}`);
	}

	return `Bearer ${parameters.join(', ')}`;
};
export const agentResourceMetadataUrl = (config: AgentAuthConfig) =>
	new URL(
		config.metadataRoute ?? DEFAULT_AGENT_RESOURCE_METADATA_ROUTE,
		config.resource
	).toString();

const failureResponse = (
	config: AgentAuthConfig,
	failure: AgentAuthFailure,
	requiredScopes: string[]
) =>
	new Response(
		JSON.stringify({
			error:
				failure.code === 'Forbidden'
					? 'insufficient_scope'
					: 'invalid_token',
			error_description: failure.message
		}),
		{
			headers: {
				'content-type': 'application/json',
				'www-authenticate': agentAuthChallenge({
					config,
					error:
						failure.code === 'Forbidden'
							? 'insufficient_scope'
							: 'invalid_token',
					requiredScopes
				})
			},
			status:
				failure.code === 'Forbidden'
					? HTTP_FORBIDDEN
					: HTTP_UNAUTHORIZED
		}
	);

const json = (value: unknown, status = HTTP_OK) =>
	new Response(JSON.stringify(value), {
		headers: {
			'cache-control': 'no-store',
			'content-type': 'application/json'
		},
		status
	});

const recordBody = (body: unknown) => {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return undefined;
	}

	return Object.fromEntries(Object.entries(body));
};

const registrationResponse = (
	result: Exclude<
		Awaited<ReturnType<typeof startAgentRegistration>>,
		{ error: string }
	>
) => {
	const body: Record<string, unknown> = {
		...(result.assertionExpires > 0
			? {
					assertion_expires: new Date(
						result.assertionExpires
					).toISOString()
				}
			: {}),
		...(result.claim === undefined ? {} : { claim: result.claim }),
		...(result.claimToken === undefined
			? {}
			: { claim_token: result.claimToken }),
		...(result.claimTokenExpires === undefined
			? {}
			: {
					claim_token_expires: new Date(
						result.claimTokenExpires
					).toISOString()
				}),
		...(result.identityAssertion === undefined
			? {}
			: { identity_assertion: result.identityAssertion }),
		...(result.preClaimScopes === undefined
			? {}
			: { pre_claim_scopes: result.preClaimScopes }),
		post_claim_scopes: result.postClaimScopes,
		registration_id: result.registrationId,
		registration_type: result.registrationType
	};
	if (
		result.registrationType === 'identity_assertion' &&
		result.identityAssertion === undefined
	) {
		return json(
			{
				...body,
				error: 'interaction_required',
				error_description:
					'Authenticate at the service and confirm the account link.'
			},
			HTTP_UNAUTHORIZED
		);
	}

	return json(body);
};

const parseRegistrationInput = (value: Record<string, unknown>) => {
	if (value.type === 'anonymous') {
		const input: StartAgentRegistrationInput = { type: 'anonymous' };

		return input;
	}
	if (value.type === 'service_auth' && typeof value.login_hint === 'string') {
		const input: StartAgentRegistrationInput = {
			loginHint: value.login_hint,
			type: 'service_auth'
		};

		return input;
	}
	if (
		value.type !== 'identity_assertion' ||
		value.assertion_type !== AGENT_IDENTITY_ASSERTION_TYPE ||
		typeof value.assertion !== 'string'
	) {
		return undefined;
	}
	const input: StartAgentRegistrationInput = {
		assertion: value.assertion,
		assertionType: AGENT_IDENTITY_ASSERTION_TYPE,
		type: 'identity_assertion'
	};

	return input;
};

const escapeHtml = (value: string) =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');

export { agentRegistrationDiscoveryMetadata };
export const agentAuthContextPlugin = (config?: AgentAuthConfig) =>
	new Elysia().derive(({ request }) => ({
		protectAgent: async <AuthReturn, AuthFailReturn>(
			requiredScopes: string[],
			handleAuth: (
				principal: AgentPrincipal
			) => AuthReturn | Promise<AuthReturn>,
			handleAuthFail?: (
				error: AgentAuthFailure
			) => AuthFailReturn | Promise<AuthFailReturn>
		) => {
			if (config === undefined) {
				const failure: AgentAuthFailure = {
					code: 'Unauthorized',
					message: 'Agent is not authenticated'
				};

				return (
					(await handleAuthFail?.(failure)) ??
					new Response(failure.message, { status: 401 })
				);
			}

			const principal = await resolveAgentPrincipal(request, config);
			if (principal === undefined) {
				const failure: AgentAuthFailure = {
					code: 'Unauthorized',
					message: 'Agent is not authenticated'
				};

				return (
					(await handleAuthFail?.(failure)) ??
					failureResponse(config, failure, requiredScopes)
				);
			}
			if (!agentHasScopes(principal, requiredScopes)) {
				const failure: AgentAuthFailure = {
					code: 'Forbidden',
					message: 'Insufficient agent scopes'
				};

				return (
					(await handleAuthFail?.(failure)) ??
					failureResponse(config, failure, requiredScopes)
				);
			}

			return handleAuth(principal);
		}
	}));

export const agentAuthPlugin = (config?: AgentAuthConfig) => {
	const plugin = agentAuthContextPlugin(config);

	if (config === undefined) return plugin.as('global');

	if (config.agentRegistration === undefined) {
		return plugin
			.get(
				config.metadataRoute ?? DEFAULT_AGENT_RESOURCE_METADATA_ROUTE,
				() => agentProtectedResourceMetadata(config)
			)
			.as('global');
	}
	const registration = config.agentRegistration;
	const identityRoute = registration.identityRoute ?? '/agent/identity';
	const claimRoute = registration.claimRoute ?? '/agent/identity/claim';
	const completeRoute =
		registration.completeRoute ?? '/agent/identity/claim/complete';
	const guideRoute = registration.guideRoute ?? '/auth.md';

	return plugin
		.get(
			config.metadataRoute ?? DEFAULT_AGENT_RESOURCE_METADATA_ROUTE,
			() => agentProtectedResourceMetadata(config)
		)
		.get(
			guideRoute,
			() =>
				new Response(generateAgentRegistrationGuide(config), {
					headers: {
						'cache-control': 'public, max-age=300',
						'content-type': 'text/markdown; charset=utf-8'
					}
				})
		)
		.get(completeRoute, ({ query }) => {
			const token =
				typeof query.claim_attempt_token === 'string'
					? query.claim_attempt_token
					: '';
			if (token.length === 0)
				return new Response('Invalid claim link', { status: 400 });

			return new Response(
				`<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Confirm agent registration</title></head><body><main><h1>Confirm agent registration</h1><p>Sign in to this service, verify the agent and scopes shown by your agent, then enter the six-digit code.</p><form method="post"><input type="hidden" name="claim_attempt_token" value="${escapeHtml(token)}"><label>Code <input name="user_code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></label><button type="submit">Confirm</button></form></main></body></html>`,
				{
					headers: {
						'cache-control': 'no-store',
						'content-security-policy':
							"default-src 'none'; form-action 'self'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'",
						'content-type': 'text/html; charset=utf-8',
						'x-content-type-options': 'nosniff'
					}
				}
			);
		})
		.post(identityRoute, async ({ body }) => {
			const value = recordBody(body);
			if (value === undefined || typeof value.type !== 'string') {
				return json({ error: 'invalid_request' }, HTTP_BAD_REQUEST);
			}
			const input = parseRegistrationInput(value);
			if (input === undefined)
				return json({ error: 'invalid_request' }, HTTP_BAD_REQUEST);
			const result = await startAgentRegistration(config, input);
			if ('error' in result) {
				return json(
					{
						error: result.error,
						...(result.message === undefined
							? {}
							: { error_description: result.message })
					},
					result.status
				);
			}

			return registrationResponse(result);
		})
		.post(claimRoute, async ({ body }) => {
			const value = recordBody(body);
			if (
				value === undefined ||
				typeof value.claim_token !== 'string' ||
				typeof value.email !== 'string'
			) {
				return json({ error: 'invalid_request' }, HTTP_BAD_REQUEST);
			}
			const result = await beginAgentClaim(config, {
				claimToken: value.claim_token,
				email: value.email
			});
			if ('error' in result)
				return json({ error: result.error }, result.status);

			return json({ claim_attempt: result.claimAttempt });
		})
		.post(completeRoute, async ({ body, request }) => {
			let value = recordBody(body);
			if (value === undefined && typeof body === 'string') {
				value = Object.fromEntries(new URLSearchParams(body));
			}
			if (
				value === undefined ||
				typeof value.claim_attempt_token !== 'string' ||
				typeof value.user_code !== 'string'
			) {
				return json({ error: 'invalid_request' }, HTTP_BAD_REQUEST);
			}
			const result = await completeAgentClaim(config, {
				attemptToken: value.claim_attempt_token,
				request,
				userCode: value.user_code
			});
			if ('error' in result)
				return json({ error: result.error }, result.status);

			return new Response(null, { status: 204 });
		})
		.as('global');
};
