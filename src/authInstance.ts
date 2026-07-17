import type { protectRoutePlugin } from './routes/protectRoute';

/** The consumer-facing context contributed by `auth()`. Configurable auth
 * routes are available at runtime but intentionally omitted from this type:
 * their user-defined paths cannot form useful literal route declarations.
 * Optional step-up and agent contexts remain available through their explicit
 * plugins without multiplying the default application's Elysia type graph. */
export type AuthInstance<UserType> = ReturnType<
	typeof protectRoutePlugin<UserType>
>;
