const dependencyIds = new WeakMap<object, number>();
let nextDependencyId = 1;

/** Stable process-local seed for configured Elysia dependencies. */
export const pluginDependencySeed = (dependency?: object) => {
	if (dependency === undefined) return 'default';

	const existing = dependencyIds.get(dependency);
	if (existing !== undefined) return existing;

	const identity = nextDependencyId;
	nextDependencyId += 1;
	dependencyIds.set(dependency, identity);

	return identity;
};
