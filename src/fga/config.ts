import type { FgaSchema, RelationRule, Warrant, WarrantStore } from './types';

const DEFAULT_MAX_DEPTH = 16;

export type FgaConfig = {
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
	// eslint-disable-next-line absolute/no-explicit-return-type -- mutually recursive; TS needs the annotation
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
	// eslint-disable-next-line absolute/no-explicit-return-type -- mutually recursive; TS needs the annotation
): Promise<boolean> => {
	if (rule.kind === 'self') {
		return matchesSelf(context, resourceType, resourceId, relation, depth);
	}
	if (rule.kind === 'computedUserset') {
		return evaluate(context, resourceType, resourceId, rule.relation, depth - 1);
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
	// eslint-disable-next-line absolute/no-explicit-return-type -- mutually recursive; TS needs the annotation
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

// Check API: does the subject have `relation` on the resource (following the schema's
// inheritance rules)?
export const check = async (config: FgaConfig, query: CheckQuery) => {
	const context: EvalContext = {
		config,
		subjectId: query.subjectId,
		subjectType: query.subjectType,
		visited: new Set()
	};

	return evaluate(
		context,
		query.resourceType,
		query.resourceId,
		query.relation,
		config.maxDepth ?? DEFAULT_MAX_DEPTH
	);
};

const expand = async (
	config: FgaConfig,
	resourceType: string,
	resourceId: string,
	relation: string,
	depth: number,
	found: Map<string, Subject>,
	visited: Set<string>
	// eslint-disable-next-line absolute/no-explicit-return-type -- recursive; TS needs the annotation
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
	// eslint-disable-next-line absolute/no-explicit-return-type -- mutually recursive; TS needs the annotation
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
	listSubjects: (query: {
		relation: string;
		resourceId: string;
		resourceType: string;
	}) => listSubjects(config, query),
	writeWarrant: (warrant: Warrant) => writeWarrant(config, warrant)
});

export const deleteWarrant = (config: FgaConfig, warrant: Warrant) =>
	config.warrantStore.deleteWarrant(warrant);

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

export const writeWarrant = (config: FgaConfig, warrant: Warrant) =>
	config.warrantStore.saveWarrant(warrant);
