import Elysia from 'elysia';
import { schema, type User } from './db/schema';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { absoluteAuth } from '../src';
import { Example } from './components/Example';
import { handlePageRequest } from './utils/pageUtils';
import { staticPlugin } from '@elysiajs/static';
import { createUser, getUser } from './utils/userUtils';
import { Protected } from './components/Protected';
import { NotAuthorized } from './components/NotAuthorized';
import { instantiateUserSession } from '../src/utils';
import { build, networkingPlugin } from '@absolutejs/absolute';

const manifest = await build({
	reactPagesDir: 'src/frontend/pages',
	reactIndexDir: 'src/frontend/indexes',
	assetsDir: 'src/backend/assets'
});

if(manifest === null) throw new Error('Failed to build the application manifest');

if (
	!Bun.env.GOOGLE_CLIENT_ID ||
	!Bun.env.GOOGLE_CLIENT_SECRET ||
	!Bun.env.GOOGLE_REDIRECT_URI
) {
	throw new Error('Google OAuth2 credentials are not set in .env file');
}

if (
	!Bun.env.FACEBOOK_CLIENT_ID ||
	!Bun.env.FACEBOOK_CLIENT_SECRET ||
	!Bun.env.FACEBOOK_REDIRECT_URI
) {
	throw new Error('Facebook OAuth2 credentials are not set in .env file');
}

if (!Bun.env.DATABASE_URL) {
	throw new Error('DATABASE_URL is not set in .env file');
}

const sql = neon(Bun.env.DATABASE_URL);
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
				Google: {
					credentials: [
						Bun.env.GOOGLE_CLIENT_ID,
						Bun.env.GOOGLE_CLIENT_SECRET,
						Bun.env.GOOGLE_REDIRECT_URI
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
				},
				GitHub: {
					credentials: ['clientId', 'clientSecret', null],
					scopes: ['read:user']
				},
				Facebook: {
					credentials: [
						Bun.env.FACEBOOK_CLIENT_ID,
						Bun.env.FACEBOOK_CLIENT_SECRET,
						Bun.env.FACEBOOK_REDIRECT_URI
					]
				}
			},
			onCallback: async ({
				authProvider,
				userProfile,
				user_session_id,
				session
			}) =>
				await instantiateUserSession<User>({
					getUser: () =>
						getUser({
							db,
							schema,
							authProvider,
							userProfile
						}),
					createUser: () =>
						createUser({
							db,
							schema,
							authProvider,
							userProfile
						}),
					authProvider,
					userProfile,
					session,
					user_session_id
				})
		})
	)
	.get('/', () =>
		handlePageRequest(Example, manifest['ExampleIndex'])
	)
	.get('/page1', () =>
		handlePageRequest(Example, manifest[`ExampleIndex`])
	)
	.get('/page2', () =>
		handlePageRequest(Example, manifest[`ExampleIndex`])
	)
	.get('/protected', ({ protectRoute }) =>
		protectRoute(
			() =>
				handlePageRequest(
					Protected,
					manifest['ProtectedIndex']
				),
			() =>
				handlePageRequest(
					NotAuthorized,
					manifest['NotAuthorizedIndex']
				)
		)
	)
	.use(networkingPlugin)
	.on('error', (error: any) => {
		console.error(`Server error: ${error.code}`);
	});
