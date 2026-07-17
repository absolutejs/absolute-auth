import { Elysia } from 'elysia';
import {
	DEFAULT_AGENT_RESOURCE_METADATA_ROUTE,
	type AgentAuthConfig
} from './config';
import { agentHasScopes, resolveAgentPrincipal } from './principal';
import type { AgentPrincipal } from './types';
import { pluginDependencySeed } from '../pluginIdentity';

type AgentAuthFailure = {
	code: 'Forbidden' | 'Unauthorized';
	message: 'Agent is not authenticated' | 'Insufficient agent scopes';
};

const DELETE_CODE_POINT = 127;
const HTTP_FORBIDDEN = 403;
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

export const agentAuthContextPlugin = (config?: AgentAuthConfig) =>
	new Elysia({
		name: '@absolutejs/auth/agent-context',
		seed: pluginDependencySeed(config)
	})
		.derive(({ request }) => ({
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
						new Response(failure.message, {
							status: HTTP_UNAUTHORIZED
						})
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
		}))
		.as('global');
