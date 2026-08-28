import { describe, expect, test } from 'bun:test';
import { Elysia, StatusMap } from 'elysia';
import { createAuthContext } from '../src/authContext';
import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import { protectRoutePlugin } from '../src/routes/protectRoute';

type TestUser = {
	id: string;
};

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends <
		Value
	>() => Value extends Right ? 1 : 2
		? true
		: false;

type Expect<Condition extends true> = Condition;

const createInferenceApplication = () =>
	new Elysia()
		.use(
			protectRoutePlugin<TestUser>({
				authSessionStore: createInMemoryAuthSessionStore<TestUser>()
			})
		)
		.get('/sync', ({ protectRoute }) =>
			protectRoute((user) => ({ id: user.id }))
		)
		.get('/async', ({ protectRoute }) =>
			protectRoute(async (user) => ({ id: user.id }))
		);

const createPlainInferenceApplication = () =>
	new Elysia().get('/plain', () => ({ id: 'plain' }));

const createComposedInferenceApplication = () =>
	new Elysia()
		.use(
			createAuthContext<TestUser>({
				authSessionStore: createInMemoryAuthSessionStore<TestUser>()
			})
		)
		.get('/composed', ({ protectRoute }) =>
			protectRoute(async (user) => ({ id: user.id }))
		);

type InferenceRoutes = ReturnType<typeof createInferenceApplication>['~Routes'];

export type SyncSuccessInference = Expect<
	Equal<
		InferenceRoutes['sync']['get']['response'][(typeof StatusMap)['OK']],
		{ id: string }
	>
>;

export type PlainSuccessInference = Expect<
	Equal<
		ReturnType<
			typeof createPlainInferenceApplication
		>['~Routes']['plain']['get']['response'][(typeof StatusMap)['OK']],
		{ id: string }
	>
>;

export type AsyncSuccessInference = Expect<
	Equal<
		InferenceRoutes['async']['get']['response'][(typeof StatusMap)['OK']],
		{ id: string }
	>
>;

type ComposedInferenceRoutes = ReturnType<
	typeof createComposedInferenceApplication
>['~Routes'];

export type ComposedSuccessInference = Expect<
	Equal<
		ComposedInferenceRoutes['composed']['get']['response'][(typeof StatusMap)['OK']],
		{ id: string }
	>
>;

describe('protectRoute inference', () => {
	test('preserves synchronous and asynchronous success responses', () => {
		const application = createInferenceApplication();
		const composedApplication = createComposedInferenceApplication();
		const plainApplication = createPlainInferenceApplication();

		expect(application).toBeDefined();
		expect(composedApplication).toBeDefined();
		expect(plainApplication).toBeDefined();
	});
});
