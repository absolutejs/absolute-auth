import type { FgaSchema, RelationRule, Warrant, WarrantStore } from './types';

const DEFAULT_MAX_DEPTH = 16;
const DEFAULT_CACHE_TTL_MS = 5000;
const DEFAULT_CACHE_MAX_ENTRIES = 10000;

// Optional memoization for `check`. Bounds reads at the cost of TTL-bounded staleness; writes
// through `writeWarrant`/`deleteWarrant` clear it on the writing instance (other instances see
// staleness up to ttlMs). Supply your own (e.g. Redis-backed) or use createInMemoryCheckCache.
//
// `get` may be sync or async so a network-backed cache (Redis) can implement the contract;
// `set` and `clear` are fire-and-forget for the in-memory path and may return promises that
// are intentionally not awaited for the Redis path (cache is a hint, not a source of truth).
export type FgaCache = {
	clear: () => void | Promise<void>;
	get: (key: string) => boolean | undefined | Promise<boolean | undefined>;
	set: (key: string, value: boolean) => void | Promise<void>;
};

export type FgaConfig = {
	cache?: FgaCache;
	maxDepth?: number;
	schema: FgaSchema;
	warrantStore: WarrantStore;
};

export type CheckQuery = {
	relation: string;
	resourceId: string;
	resourceType: string;
	subjectId: string;
	subjectType: string;
};

export type Subject = {
	subjectId: string;
	subjectType: string;
};

export type ObjectQuery = {
	relation: string;
	resourceType: string;
	subjectId: string;
	subjectType: string;
};

type EvalContext = {
	config: FgaConfig;
	subjectId: string;
	subjectType: string;
	visited: Set<string>;
};

const SELF_RULE: RelationRule = { kind: 'self' };

const ruleFor = (schema: FgaSchema, resourceType: string, relation: string) =>
	schema[resourceType]?.[relation] ?? SELF_RULE;

const isUser = (warrant: Warrant) => warrant.subjectRelation === undefined;

const isUserset = (
	warrant: Warrant
): warrant is Warrant & { subjectRelation: string } =>
	warrant.subjectRelation !== undefined;

const matchesSelf = async (
	context: EvalContext,
	resourceType: string,
	resourceId: string,
	relation: string,
	depth: number
): Promise<boolean> => {
	const warrants = await context.config.warrantStore.listForResource(
		resourceType,
		resourceId,
		relation
	);
	const direct = warrants.some(
		(warrant) =>
			isUser(warrant) &&
			warrant.subjectType === context.subjectType &&
			warrant.subjectId === context.subjectId
	);
	if (direct) return true;

	const expanded = await Promise.all(
		warrants
			.filter(isUserset)
			.map((warrant) =>
				evaluate(
					context,
					warrant.subjectType,
					warrant.subjectId,
					warrant.subjectRelation,
					depth - 1
				)
			)
	);

	return expanded.includes(true);
};

const matchesRule = async (
	context: EvalContext,
	resourceType: string,
	resourceId: string,
	relation: string,
	rule: RelationRule,
	depth: number
): Promise<boolean> => {
	if (rule.kind === 'self') {
		return matchesSelf(context, resourceType, resourceId, relation, depth);
	}
	if (rule.kind === 'computedUserset') {
		return evaluate(
			context,
			resourceType,
			resourceId,
			rule.relation,
			depth - 1
		);
	}
	if (rule.kind === 'tupleToUserset') {
		const links = await context.config.warrantStore.listForResource(
			resourceType,
			resourceId,
			rule.viaRelation
		);
		const results = await Promise.all(
			links.map((link) =>
				evaluate(
					context,
					link.subjectType,
					link.subjectId,
					rule.relation,
					depth - 1
				)
			)
		);

		return results.includes(true);
	}
	const unionResults = await Promise.all(
		rule.rules.map((sub) =>
			matchesRule(context, resourceType, resourceId, relation, sub, depth)
		)
	);

	return unionResults.includes(true);
};

const evaluate = async (
	context: EvalContext,
	resourceType: string,
	resourceId: string,
	relation: string,
	depth: number
): Promise<boolean> => {
	const key = `${resourceType}:${resourceId}#${relation}`;
	if (depth <= 0 || context.visited.has(key)) return false;
	context.visited.add(key);

	return matchesRule(
		context,
		resourceType,
		resourceId,
		relation,
		ruleFor(context.config.schema, resourceType, relation),
		depth
	);
};

const cacheKey = (query: CheckQuery) =>
	`${query.resourceType}:${query.resourceId}#${query.relation}@${query.subjectType}:${query.subjectId}`;

// Check API: does the subject have `relation` on the resource (following the schema's
// inheritance rules)? Memoized when `config.cache` is set.
export const check = async (config: FgaConfig, query: CheckQuery) => {
	const key = cacheKey(query);
	const cached = await config.cache?.get(key);
	if (cached !== undefined) return cached;

	const context: EvalContext = {
		config,
		subjectId: query.subjectId,
		subjectType: query.subjectType,
		visited: new Set()
	};

	const result = await evaluate(
		context,
		query.resourceType,
		query.resourceId,
		query.relation,
		config.maxDepth ?? DEFAULT_MAX_DEPTH
	);
	config.cache?.set(key, result);

	return result;
};

// In-memory TTL cache for `check`. ttlMs bounds staleness; maxEntries caps memory (oldest
// entry evicted first). For multi-instance setups, supply a shared (e.g. Redis) FgaCache.
export const createInMemoryCheckCache = ({
	maxEntries = DEFAULT_CACHE_MAX_ENTRIES,
	ttlMs = DEFAULT_CACHE_TTL_MS
}: { maxEntries?: number; ttlMs?: number } = {}): FgaCache => {
	const entries = new Map<string, { expiresAt: number; value: boolean }>();

	return {
		clear: () => entries.clear(),
		get: (key) => {
			const hit = entries.get(key);
			if (hit === undefined) return undefined;
			if (hit.expiresAt < Date.now()) {
				entries.delete(key);

				return undefined;
			}

			return hit.value;
		},
		set: (key, value) => {
			const [oldest] = entries.keys();
			if (entries.size >= maxEntries && oldest !== undefined) {
				entries.delete(oldest);
			}
			entries.set(key, { expiresAt: Date.now() + ttlMs, value });
		}
	};
};

const expand = async (
	config: FgaConfig,
	resourceType: string,
	resourceId: string,
	relation: string,
	depth: number,
	found: Map<string, Subject>,
	visited: Set<string>
): Promise<void> => {
	const key = `${resourceType}:${resourceId}#${relation}`;
	if (depth <= 0 || visited.has(key)) return;
	visited.add(key);

	await expandRule(
		config,
		resourceType,
		resourceId,
		relation,
		ruleFor(config.schema, resourceType, relation),
		depth,
		found,
		visited
	);
};

const expandRule = async (
	config: FgaConfig,
	resourceType: string,
	resourceId: string,
	relation: string,
	rule: RelationRule,
	depth: number,
	found: Map<string, Subject>,
	visited: Set<string>
): Promise<void> => {
	if (rule.kind === 'computedUserset') {
		await expand(
			config,
			resourceType,
			resourceId,
			rule.relation,
			depth - 1,
			found,
			visited
		);

		return;
	}
	if (rule.kind === 'tupleToUserset') {
		const links = await config.warrantStore.listForResource(
			resourceType,
			resourceId,
			rule.viaRelation
		);
		await Promise.all(
			links.map((link) =>
				expand(
					config,
					link.subjectType,
					link.subjectId,
					rule.relation,
					depth - 1,
					found,
					visited
				)
			)
		);

		return;
	}
	if (rule.kind === 'union') {
		await Promise.all(
			rule.rules.map((sub) =>
				expandRule(
					config,
					resourceType,
					resourceId,
					relation,
					sub,
					depth,
					found,
					visited
				)
			)
		);

		return;
	}

	const warrants = await config.warrantStore.listForResource(
		resourceType,
		resourceId,
		relation
	);
	for (const warrant of warrants.filter(isUser)) {
		found.set(`${warrant.subjectType}:${warrant.subjectId}`, {
			subjectId: warrant.subjectId,
			subjectType: warrant.subjectType
		});
	}
	await Promise.all(
		warrants
			.filter(isUserset)
			.map((warrant) =>
				expand(
					config,
					warrant.subjectType,
					warrant.subjectId,
					warrant.subjectRelation,
					depth - 1,
					found,
					visited
				)
			)
	);
};

// DX wrapper: bind the config once.
export const createFgaEngine = (config: FgaConfig) => ({
	check: (query: CheckQuery) => check(config, query),
	deleteWarrant: (warrant: Warrant) => deleteWarrant(config, warrant),
	listObjects: (query: ObjectQuery) => listObjects(config, query),
	listSubjects: (query: {
		relation: string;
		resourceId: string;
		resourceType: string;
	}) => listSubjects(config, query),
	writeWarrant: (warrant: Warrant) => writeWarrant(config, warrant)
});

export const deleteWarrant = async (config: FgaConfig, warrant: Warrant) => {
	await config.warrantStore.deleteWarrant(warrant);
	config.cache?.clear();
};

// Reverse query: which resources of `resourceType` does the subject have `relation` on? v1
// enumerates the candidate resource ids from the warrant store and `check`s each (correct for
// any schema — every reachable resource appears as a resource in some warrant; for very high
// object counts add a reverse index). Returns the matching resource ids.
export const listObjects = async (config: FgaConfig, query: ObjectQuery) => {
	const candidates = await config.warrantStore.listResourceIds(
		query.resourceType
	);
	const allowed = await Promise.all(
		candidates.map((resourceId) =>
			check(config, {
				relation: query.relation,
				resourceId,
				resourceType: query.resourceType,
				subjectId: query.subjectId,
				subjectType: query.subjectType
			})
		)
	);

	return candidates.filter((_resourceId, index) => allowed[index] === true);
};

// Query API: list the user subjects that have `relation` on the resource (expanding rules).
export const listSubjects = async (
	config: FgaConfig,
	query: { relation: string; resourceId: string; resourceType: string }
) => {
	const found = new Map<string, Subject>();
	await expand(
		config,
		query.resourceType,
		query.resourceId,
		query.relation,
		config.maxDepth ?? DEFAULT_MAX_DEPTH,
		found,
		new Set()
	);

	return [...found.values()];
};

export const writeWarrant = async (config: FgaConfig, warrant: Warrant) => {
	await config.warrantStore.saveWarrant(warrant);
	config.cache?.clear();
};
