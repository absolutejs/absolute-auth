import {
	defineImplementation,
	defineManifest,
	toolFactory
} from '@absolutejs/manifest';
import { Type } from '@sinclair/typebox';
import type { AuthConfig } from './types';

const tool = toolFactory<never>();

/* Providers whose citra credentials are the standard clientId/clientSecret
 * pair (see providersFromEnv). Exotic credential shapes (apple) are
 * configured manually in providersConfiguration. */
const COMMON_PROVIDERS = [
	'discord',
	'facebook',
	'github',
	'google',
	'linkedin',
	'microsoft',
	'slack',
	'spotify',
	'twitch'
] as const;

const providerEnv = COMMON_PROVIDERS.flatMap((provider) => {
	const upper = provider.toUpperCase();
	const title = provider.charAt(0).toUpperCase() + provider.slice(1);

	return [
		{
			description: `${title} OAuth client id`,
			docsUrl: 'https://github.com/absolutejs/auth#providers',
			key: `${upper}_CLIENT_ID`,
			when: `providersConfiguration.${provider}`
		},
		{
			description: `${title} OAuth client secret`,
			docsUrl: 'https://github.com/absolutejs/auth#providers',
			key: `${upper}_CLIENT_SECRET`,
			secret: true,
			when: `providersConfiguration.${provider}`
		}
	];
});

/* Serializable deep-subset of AuthConfig<unknown>. getUser, all on*
 * callbacks, and the function-bearing feature blocks (credentials, mfa, sso,
 * scim, oidc, …) are wiring concerns. Provider entries omit `credentials` —
 * providersFromEnv merges them from env inside the user's app. */
const settings = Type.Object({
	cleanupIntervalMs: Type.Optional(
		Type.Number({
			description:
				'How often expired sessions are swept, in milliseconds.',
			minimum: 1000,
			title: 'Session cleanup interval',
			'x-group': 'advanced'
		})
	),
	cookieSecure: Type.Optional(
		Type.Boolean({
			description:
				'Only send the sign-in cookie over HTTPS. Leave off in local development.',
			title: 'HTTPS-only cookies',
			'x-group': 'advanced'
		})
	),
	maxSessions: Type.Optional(
		Type.Integer({
			description:
				'How many devices someone can stay signed in on at once.',
			minimum: 1,
			title: 'Signed-in devices per person',
			'x-group': 'sessions'
		})
	),
	providersConfiguration: Type.Optional(
		Type.Record(
			Type.String(),
			Type.Object({
				scope: Type.Optional(
					Type.Array(Type.String(), {
						description:
							'Extra permissions to request from the provider.',
						title: 'Permissions'
					})
				)
			}),
			{
				description:
					'Which services people can sign in with. Each needs a client id and secret from that provider.',
				title: 'Sign-in providers',
				'x-group': 'providers'
			}
		)
	),
	sessionDurationMs: Type.Optional(
		Type.Number({
			description:
				'How long someone stays signed in, in milliseconds. Default is 7 days.',
			minimum: 60000,
			title: 'Stay signed in for',
			'x-group': 'sessions'
		})
	)
});

export const manifest = defineManifest<AuthConfig<unknown>, never>()({
	contract: 1,
	identity: {
		accent: '#6366f1',
		category: 'auth',
		description:
			'OAuth/OIDC sign-in for 60+ providers, email/password, magic links, passkeys, MFA, enterprise SSO/SCIM, organizations, roles, and API keys — one Elysia plugin backed by your Postgres database.',
		docsUrl: 'https://github.com/absolutejs/auth',
		name: '@absolutejs/auth',
		tagline: 'Let people create accounts and sign in.'
	},
	implements: [
		defineImplementation<never>()({
			contract: 'auth/session-store',
			factory: 'createNeonAuthSessionStore',
			from: '@absolutejs/auth',
			requires: {
				env: [
					{
						description: 'Postgres connection string',
						example: 'postgres://user:pass@host/db',
						key: 'DATABASE_URL',
						secret: true
					}
				]
			},
			title: 'Your Postgres database (recommended)',
			wiring: {
				code: 'createNeonAuthSessionStore(${env.DATABASE_URL} ?? "")',
				imports: [
					{
						from: '@absolutejs/auth',
						names: ['createNeonAuthSessionStore']
					}
				]
			}
		}),
		defineImplementation<never>()({
			contract: 'auth/session-store',
			factory: 'createInMemoryAuthSessionStore',
			from: '@absolutejs/auth',
			title: 'In memory (development only — sign-ins reset on restart)',
			wiring: {
				code: 'createInMemoryAuthSessionStore()',
				imports: [
					{
						from: '@absolutejs/auth',
						names: ['createInMemoryAuthSessionStore']
					}
				]
			}
		})
	],
	lifecycle: [
		{
			id: 'migrate',
			idempotent: true,
			kind: 'migration',
			title: 'Set up the sign-in tables in your database',
			// The CLI falls back to the DATABASE_URL env var for --db.
			command: 'bunx absolute-auth migrate',
			when: 'after-install'
		},
		{
			id: 'migrate-upgrade',
			idempotent: true,
			kind: 'migration',
			title: 'Apply new sign-in tables after upgrading',
			command: 'bunx absolute-auth migrate',
			when: 'after-upgrade'
		}
	],
	presets: [
		{
			id: 'social-login',
			title: 'Social login (Google + GitHub)',
			values: {
				providersConfiguration: { github: {}, google: {} }
			}
		}
	],
	requires: {
		env: [
			{
				description: 'Postgres connection string (sign-in tables live here)',
				example: 'postgres://user:pass@host/db',
				key: 'DATABASE_URL',
				secret: true
			},
			...providerEnv
		],
		peers: [{ name: 'elysia', range: '>=1.0', reason: 'plugin host' }],
		services: [
			{
				description: 'Stores accounts, sessions, and audit events',
				id: 'postgres'
			}
		]
	},
	settings,
	slots: {
		sessionStore: {
			configPath: 'authSessionStore',
			contract: 'auth/session-store',
			description: 'Where live sign-in sessions are kept',
			known: ['@absolutejs/auth#postgres', '@absolutejs/auth#memory'],
			required: true
		}
	},
	tools: {
		list_sign_in_providers: tool.workspace({
			annotations: { readOnlyHint: true },
			capabilities: ['read', 'glob'],
			description:
				'List which sign-in providers this project has configured, and which are missing credentials.',
			handler: async (_input, workspace) => {
				const files = (await workspace.glob?.('**/auth.config.ts')) ?? [];
				const [file] = files;
				if (file === undefined)
					return 'auth is not configured yet — no auth.config.ts found';
				const source = (await workspace.read(file)) ?? '';
				const providers = [
					...source.matchAll(/(\w+):\s*\{/g)
				]
					.map((match) => match[1])
					.filter(
						(name) =>
							name !== undefined &&
							name !== 'providersConfiguration' &&
							name !== 'scope'
					);

				return providers.length === 0
					? 'no sign-in providers configured'
					: `configured providers: ${providers.join(', ')}`;
			},
			input: Type.Object({})
		})
	},
	wiring: [
		{
			description:
				'Sign in with Google, GitHub, and 60+ other services. Add email/password later from settings.',
			id: 'default',
			server: {
				code: [
					'.use(',
					'\tawait auth({',
					'\t\t// TODO: return your application user for a session subject.',
					'\t\tgetUser: (sub) => ({ sub }),',
					'\t\tauthSessionStore: ${slot.sessionStore},',
					'\t\tcookieSecure: ${settings.cookieSecure},',
					'\t\tmaxSessions: ${settings.maxSessions},',
					'\t\tprovidersConfiguration: providersFromEnv(${settings.providersConfiguration} ?? {}),',
					'\t\tsessionDurationMs: ${settings.sessionDurationMs}',
					'\t})',
					')'
				].join('\n'),
				imports: [
					{
						from: '@absolutejs/auth',
						names: ['auth', 'providersFromEnv']
					}
				],
				placement: 'server-plugin'
			},
			title: 'Social sign-in (OAuth)'
		}
	]
});

export default manifest;
