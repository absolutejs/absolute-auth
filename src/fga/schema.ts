import type { FgaSchema, RelationRule } from './types';

// Parse an OpenFGA-style schema DSL into an FgaSchema. Supported grammar (one statement per
// line; blank lines, `#` comments and the `relations` keyword are ignored):
//
//   type document
//     relations
//       define parent: [folder]
//       define editor: [user]
//       define viewer: [user] or editor or viewer from parent
//
// A relation's expression is a set of `or`-separated terms:
//   [type]            -> self        (direct warrants; the listed types are advisory only)
//   relation          -> computedUserset (same resource)
//   relation from rel -> tupleToUserset  (via `rel`)
// A single term yields that rule directly; multiple terms yield a `union`.

const TYPE_PATTERN = /^type\s+(\w+)$/u;
const DEFINE_PATTERN = /^define\s+(\w+)\s*:\s*(.+)$/u;
const FROM_PATTERN = /^(\w+)\s+from\s+(\w+)$/u;
const OR_SEPARATOR = /\s+or\s+/u;

const parseTerm = (term: string) => {
	const trimmed = term.trim();
	if (trimmed.startsWith('[')) {
		const rule: RelationRule = { kind: 'self' };

		return rule;
	}

	const fromMatch = FROM_PATTERN.exec(trimmed);
	if (fromMatch) {
		const [, relation, viaRelation] = fromMatch;
		const rule: RelationRule = {
			kind: 'tupleToUserset',
			relation: relation ?? '',
			viaRelation: viaRelation ?? ''
		};

		return rule;
	}

	const rule: RelationRule = { kind: 'computedUserset', relation: trimmed };

	return rule;
};

const parseExpression = (expression: string) => {
	const terms = expression.split(OR_SEPARATOR).map(parseTerm);
	const [first] = terms;
	if (terms.length === 1 && first) return first;

	const rule: RelationRule = { kind: 'union', rules: terms };

	return rule;
};

// Records the type and returns its name (or undefined for a non-type line).
const applyType = (schema: FgaSchema, line: string) => {
	const match = TYPE_PATTERN.exec(line);
	if (!match) return undefined;

	const [, name] = match;
	if (name) schema[name] = {};

	return name;
};

const applyDefine = (
	target: Record<string, RelationRule> | undefined,
	line: string
) => {
	if (!target) return;

	const match = DEFINE_PATTERN.exec(line);
	if (!match) return;

	const [, relation, expression] = match;
	if (relation && expression) target[relation] = parseExpression(expression);
};

export const parseSchema = (dsl: string) => {
	const schema: FgaSchema = {};
	let currentType: string | undefined;

	for (const rawLine of dsl.split('\n')) {
		const line = rawLine.trim();
		if (line === '' || line.startsWith('#') || line === 'relations')
			continue;

		const typeName = applyType(schema, line);
		currentType = typeName ?? currentType;
		if (typeName !== undefined) continue;

		applyDefine(currentType ? schema[currentType] : undefined, line);
	}

	return schema;
};
