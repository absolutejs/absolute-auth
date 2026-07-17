import type { Elysia } from 'elysia';
import type { agentAuthContextPlugin } from './agents/context';
import type { protectRoutePlugin } from './routes/protectRoute';
import type { stepUpPlugin } from './routes/stepUp';

/** Merge the stable context contributed by independent Auth plugins without
 * exposing the configurable route graph in consumer declarations. */
type MergeAuthContext<Base, Extra> =
	Base extends Elysia<
		infer Path,
		infer Singleton,
		infer Definitions,
		infer Metadata,
		infer Routes,
		infer Ephemeral,
		infer Volatile
	>
		? Extra extends Elysia<
				infer ExtraPath,
				infer ExtraSingleton,
				infer ExtraDefinitions,
				infer ExtraMetadata,
				infer ExtraRoutes,
				infer ExtraEphemeral,
				infer ExtraVolatile
			>
			? Elysia<
					Path & ExtraPath,
					Singleton & ExtraSingleton,
					Definitions & ExtraDefinitions,
					Metadata & ExtraMetadata,
					Routes & ExtraRoutes,
					Ephemeral & ExtraEphemeral,
					Volatile & ExtraVolatile
				>
			: never
		: never;

/** The consumer-facing context contributed by `auth()`. Configurable auth
 * routes are available at runtime but intentionally omitted from this type:
 * their user-defined paths cannot form useful literal route declarations. */
export type AuthInstance<UserType> = MergeAuthContext<
	MergeAuthContext<
		ReturnType<typeof protectRoutePlugin<UserType>>,
		ReturnType<typeof stepUpPlugin<UserType>>
	>,
	ReturnType<typeof agentAuthContextPlugin>
>;
