import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { auth, createAuthApplications } from '../src/index';
import type { AuthConfig } from '../src/types';

type TestUser = {
	email: string;
	sub: string;
};

const HTTP_NOT_FOUND = 404;
const HTTP_OK = 200;

const configuration: AuthConfig<TestUser> = {
	authorization: {
		hasPermission: () => true
	},
	providersConfiguration: {}
};

describe('auth application composition', () => {
	test('exposes every reusable auth context through auth()', async () => {
		const authApplication = await auth<TestUser>(configuration);
		const application = new Elysia()
			.use(authApplication)
			.get(
				'/context-contract',
				({
					protectAgent,
					protectPermission,
					protectRoute,
					requireRecentAuth
				}) => ({
					protectAgent: typeof protectAgent,
					protectPermission: typeof protectPermission,
					protectRoute: typeof protectRoute,
					requireRecentAuth: typeof requireRecentAuth
				})
			);

		const response = await application.handle(
			new Request('http://localhost/context-contract')
		);

		expect(response.status).toBe(HTTP_OK);
		expect(await response.json()).toEqual({
			protectAgent: 'function',
			protectPermission: 'function',
			protectRoute: 'function',
			requireRecentAuth: 'function'
		});
	});

	test('returns independently composable typed route slices', async () => {
		const { coreRoutes } =
			await createAuthApplications<TestUser>(configuration);
		const application = new Elysia().use(coreRoutes);
		const response = await application.handle(
			new Request('http://localhost/oauth2/status')
		);

		expect(response.status).not.toBe(HTTP_NOT_FOUND);
	});
});
