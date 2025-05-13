import { env } from 'process';
import {
	build,
	handleReactPageRequest,
	networkingPlugin
} from '@absolutejs/absolute';
import { staticPlugin } from '@elysiajs/static';
import { neon } from '@neondatabase/serverless';
import { isValidProviderOption } from 'citra';
import { drizzle } from 'drizzle-orm/neon-http';
import { Elysia } from 'elysia';
import { absoluteAuth } from '../src';
import { instantiateUserSession } from '../src/utils';
import { schema, type User } from './db/schema';
import { createUser, getUser } from './handlers/userHandlers';
import { Home } from './pages/Home';
import { NotAuthorized } from './pages/NotAuthorized';
import { Protected } from './pages/Protected';
import { providerData } from './utils/providerData';

const manifest = await build({
	assetsDir: 'example/assets',
	buildDir: 'example/build',
	reactIndexDir: 'example/indexes',
	reactPagesDir: 'example/pages'
});

if (manifest === null)
	throw new Error('Failed to build the application manifest');

const homeIndex = manifest['HomeIndex'];
const protectedIndex = manifest['ProtectedIndex'];
const notAuthorizedIndex = manifest['NotAuthorizedIndex'];

if (
	homeIndex === undefined ||
	protectedIndex === undefined ||
	notAuthorizedIndex === undefined
) {
	throw new Error('Missing index file in manifest');
}

if (
	!env.GOOGLE_CLIENT_ID ||
	!env.GOOGLE_CLIENT_SECRET ||
	!env.GOOGLE_REDIRECT_URI
) {
	throw new Error('Google OAuth2 credentials are not set in .env file');
}

if (
	!env.FACEBOOK_CLIENT_ID ||
	!env.FACEBOOK_CLIENT_SECRET ||
	!env.FACEBOOK_REDIRECT_URI
) {
	throw new Error('Facebook OAuth2 credentials are not set in .env file');
}

if (
	!env.GITHUB_CLIENT_ID ||
	!env.GITHUB_CLIENT_SECRET ||
	!env.GITHUB_REDIRECT_URI
) {
	throw new Error('GitHub OAuth2 credentials are not set in .env file');
}

if (!env.DATABASE_URL) {
	throw new Error('DATABASE_URL is not set in .env file');
}

const sql = neon(env.DATABASE_URL);
const db = drizzle(sql, {
	schema
});

new Elysia()
	.use(
		staticPlugin({
			assets: './example/build',
			prefix: ''
		})
	)
	.use(
		absoluteAuth<User>({
			config: {
				facebook: {
					credentials: {
						clientId: env.FACEBOOK_CLIENT_ID,
						clientSecret: env.FACEBOOK_CLIENT_SECRET,
						redirectUri: env.FACEBOOK_REDIRECT_URI
					}
				},
				github: {
					credentials: {
						clientId: env.GITHUB_CLIENT_ID,
						clientSecret: env.GITHUB_CLIENT_SECRET,
						redirectUri: env.GITHUB_REDIRECT_URI
					},
					scope: ['read:user']
				},
				google: {
					credentials: {
						clientId: env.GOOGLE_CLIENT_ID,
						clientSecret: env.GOOGLE_CLIENT_SECRET,
						redirectUri: env.GOOGLE_REDIRECT_URI
					},
					scope: [
						'openid',
						'https://www.googleapis.com/auth/userinfo.profile',
						'https://www.googleapis.com/auth/userinfo.email'
					],
					searchParams: [
						['access_type', 'offline'],
						['prompt', 'consent']
					]
				}
			},
			onAuthorize: ({ authProvider, authorizationUrl }) => {
				const providerName = isValidProviderOption(authProvider)
					? providerData[authProvider].name
					: authProvider;

				console.log(
					`\nRedirecting to ${providerName} authorization URL:`,
					authorizationUrl.toString()
				);
			},
			onCallback: async ({
				authProvider,
				userProfile,
				tokenResponse,
				user_session_id,
				session
			}) => {
				const providerName = isValidProviderOption(authProvider)
					? providerData[authProvider].name
					: authProvider;

				console.log(
					`\nSuccesfully authorized with ${providerName} and got token response:`,
					{
						...tokenResponse
					}
				);

				return instantiateUserSession<User>({
					authProvider,
					session,
					tokenResponse,
					user_session_id,
					userProfile,
					createUser: async () => {
						const user = await createUser({
							authProvider,
							db,
							schema,
							userProfile
						});
						if (!user) throw new Error('Failed to create user');

						return user;
					},
					getUser: async () => {
						const user = await getUser({
							authProvider,
							db,
							schema,
							userProfile
						});
						if (!user) throw new Error('User not found');

						return user;
					}
				});
			},
			onProfile: ({ userProfile }) => {
				console.log('\nSuccessfully fetched user profile:', {
					...userProfile
				});
			},
			onRefresh: ({ tokenResponse }) => {
				console.log('\nSuccessfully refreshed tokens:', {
					...tokenResponse
				});
			},
			onRevocation: ({ tokenToRevoke }) => {
				console.log('\nSuccessfully revoked token:', tokenToRevoke);
			}
		})
	)
	.get('/', () => handleReactPageRequest(Home, homeIndex))
	.get('/protected', ({ protectRoute }) =>
		protectRoute(
			() => handleReactPageRequest(Protected, protectedIndex),
			() => handleReactPageRequest(NotAuthorized, notAuthorizedIndex)
		)
	)
	.use(networkingPlugin)
	.on('error', (error) => {
		const { request } = error;
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	});
