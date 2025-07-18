import { env } from 'process';
import {
	asset,
	build,
	getEnv,
	handleReactPageRequest,
	networking
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
	assetsDirectory: 'example/assets',
	buildDirectory: 'example/build',
	reactDirectory: 'example'
});

const sql = neon(getEnv('DATABASE_URL'));
const db = drizzle(sql, {
	schema
});

const server = new Elysia()
	.use(
		staticPlugin({
			assets: './example/build',
			prefix: ''
		})
	)
	.use(await absoluteAuth<User>(absoluteAuthConfig(db)))
	.get('/', () => handleReactPageRequest(Home, asset(manifest, 'HomeIndex')))
	.get('/protected', ({ protectRoute }) =>
		protectRoute(
			() =>
				handleReactPageRequest(
					Protected,
					asset(manifest, 'ProtectedIndex')
				),
			() =>
				handleReactPageRequest(
					NotAuthorized,
					asset(manifest, 'NotAuthorizedIndex')
				)
		)
	)
	.use(networking)
	.on('error', (error) => {
		const { request } = error;
		console.error(
			`Server error on ${request.method} ${request.url}: ${error.message}`
		);
	});

export type Server = typeof server;

// TODO : avoid using localhost as per RFC 8252 8.3 https://datatracker.ietf.org/doc/html/rfc8252#section-8.3
