import Elysia from 'elysia';
import { schema, type User } from './db/schema';
import { getLocalIPAddress } from './utils/networking';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { absoluteAuth } from '../src';
import { Example } from './components/Example';
import { handlePageRequest } from './utils/pageUtils';
import { rm, copyFile } from 'node:fs/promises';
import { staticPlugin } from '@elysiajs/static';
import { createUser, getUser } from './utils/userUtils';
import { Protected } from './components/Protected';
import { NotAuthorized } from './components/NotAuthorized';

let host = Bun.env.HOST || 'localhost';
const port = Number(Bun.env.PORT) || 3000;

const args = process.argv;
const hostFlag = args.includes('--host');

let localIP: string | undefined;

if (hostFlag) {
	localIP = getLocalIPAddress();
	host = '0.0.0.0';
}
const buildTimeStamp = Date.now();
await rm('./example/build', { recursive: true, force: true });
const { logs, success } = await Bun.build({
	entrypoints: [
		'./example/utils/ExampleIndex.tsx',
		'./example/utils/NotAuthorizedIndex.tsx',
		'./example/utils/ProtectedIndex.tsx'
	],
	outdir: './example/build',
	naming: `[name].${buildTimeStamp}.[ext]`,
	minify: true,
	splitting: true,
	format: 'esm'
});
copyFile('./example/utils/favicon.ico', './example/build/favicon.ico');

if (!success) {
	console.error(logs);
	throw new Error('Failed to build');
}

if (
	!Bun.env.GOOGLE_CLIENT_ID ||
	!Bun.env.GOOGLE_CLIENT_SECRET ||
	!Bun.env.GOOGLE_REDIRECT_URI
) {
	throw new Error('Google OAuth2 credentials are not set in .env file');
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
				}
			},
			createUser: async ({ decodedIdToken, authProvider }) => {
				const provider = authProvider.toUpperCase();
				const sub = decodedIdToken.sub;

				if (!sub) {
					throw new Error('Sub claim is missing from ID token');
				}

				const authSub = `${provider}|${sub}`;
				return await createUser({
					auth_sub: authSub,
					given_name: decodedIdToken.given_name ?? '',
					family_name: decodedIdToken.family_name ?? '',
					email: decodedIdToken.email ?? '',
					picture: decodedIdToken.picture ?? '',
					db,
					schema
				});
			},
			getUser: async ({ decodedIdToken, authProvider }) => {
				const provider = authProvider.toUpperCase();
				const sub = decodedIdToken.sub;

				if (!sub) {
					throw new Error('Sub claim is missing from ID token');
				}

				const authSub = `${provider}|${sub}`;
				return await getUser({ authSub, db, schema });
			}
		})
	)
	.get('/', () =>
		handlePageRequest(Example, `/ExampleIndex.${buildTimeStamp}.js`)
	)
	.get('/page1', () =>
		handlePageRequest(Example, `/ExampleIndex.${buildTimeStamp}.js`)
	)
	.get('/page2', () =>
		handlePageRequest(Example, `/ExampleIndex.${buildTimeStamp}.js`)
	)
	.get('/protected', ({ protectRoute }) =>
		protectRoute(
			() =>
				handlePageRequest(
					Protected,
					`/ProtectedIndex.${buildTimeStamp}.js`
				),
			() =>
				handlePageRequest(
					NotAuthorized,
					`/NotAuthorizedIndex.${buildTimeStamp}.js`
				)
		)
	)
	.listen(
		{
			port: port,
			hostname: host
		},
		() => {
			if (hostFlag) {
				console.log(`Server started on http://localhost:${port}`);
				console.log(
					`Server started on network: http://${localIP}:${port}`
				);
			} else {
				console.log(`Server started on http://${host}:${port}`);
			}
		}
	)
	.on('error', (error: any) => {
		console.error(`Server error: ${error.code}`);
	});
