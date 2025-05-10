import { env } from 'process';
import {
	build,
	handleReactPageRequest,
	networkingPlugin
} from '@absolutejs/absolute';
import { staticPlugin } from '@elysiajs/static';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { Elysia } from 'elysia';
import { absoluteAuth } from '../src';
import { instantiateUserSession } from '../src/utils';
import { NotAuthorized } from './components/NotAuthorized';
import { schema, type User } from './db/schema';
import { Example } from './pages/Example';
import { Protected } from './pages/Protected';
import { createUser, getUser } from './utils/userUtils';

const manifest = await build({
	assetsDir: 'example/assets',
	buildDir: 'example/build',
	reactIndexDir: 'example/indexes',
	reactPagesDir: 'example/pages'
});

if (manifest === null)
	throw new Error('Failed to build the application manifest');

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
				Facebook: {
					credentials: [
						env.FACEBOOK_CLIENT_ID,
						env.FACEBOOK_CLIENT_SECRET,
						env.FACEBOOK_REDIRECT_URI
					]
				},
				GitHub: {
					credentials: ['clientId', 'clientSecret', null],
					scopes: ['read:user']
				},
				Google: {
					credentials: [
						env.GOOGLE_CLIENT_ID,
						env.GOOGLE_CLIENT_SECRET,
						env.GOOGLE_REDIRECT_URI
					],
					scopes: [
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
			onCallback: ({
				authProvider,
				userProfile,
				user_session_id,
				session
			}) =>
				instantiateUserSession<User>({
					authProvider,
					session,
					user_session_id,
					userProfile,
					createUser: () =>
						createUser({
							authProvider,
							db,
							schema,
							userProfile
						}),
					getUser: () =>
						getUser({
							authProvider,
							db,
							schema,
							userProfile
						})
				})
		})
	)
	.get('/', () => handleReactPageRequest(Example, manifest['ExampleIndex']))
	.get('/page1', () =>
		handleReactPageRequest(Example, manifest[`ExampleIndex`])
	)
	.get('/page2', () =>
		handleReactPageRequest(Example, manifest[`ExampleIndex`])
	)
	.get('/protected', ({ protectRoute }) =>
		protectRoute(
			() => handleReactPageRequest(Protected, manifest['ProtectedIndex']),
			() =>
				handleReactPageRequest(
					NotAuthorized,
					manifest['NotAuthorizedIndex']
				)
		)
	)
	.use(networkingPlugin)
	.on('error', (error) => {
		console.error(`Server error: ${error.code}`);
	});
