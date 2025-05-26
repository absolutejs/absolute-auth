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
import { schema, type User } from './db/schema';
import { Home } from './pages/Home';
import { NotAuthorized } from './pages/NotAuthorized';
import { Protected } from './pages/Protected';
import { absoluteAuthConfig } from './utils/absoluteAuthConfig';

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
	.use(absoluteAuth<User>(absoluteAuthConfig(db)))
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

// TODO : avoid using localhost as per RFC 8252 8.3 https://datatracker.ietf.org/doc/html/rfc8252#section-8.3
