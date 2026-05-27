// SCIM enterprise polish helpers — the pieces real IdP integrations need but the core
// User/Group surface doesn't dictate. None of these touch the wire shape unless the
// consumer opts into them via `ScimConfig.customAttributes`; pure adds.
//
//   1) `defineScimAttributeMap` — declarative bidirectional map between IdP attributes
//      (e.g. Okta `manager`) and the consumer's user model (e.g. `reporting_to`). The
//      package threads inbound JSON through `fromScim` into `ScimUserInput.custom` and
//      serializes `ScimUser.custom` back via `toScim`. The IdP namespace is whatever URI
//      the consumer declares (typically an enterprise extension like
//      `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`).
//
//   2) `diffScimGroupMembers` — small set-diff helper so consumers can compute the add/
//      remove deltas from a `onScimGroupReplace` call against their existing membership
//      table without rolling their own loop.
//
//   3) Schema + ResourceType discovery types. The /Schemas + /ResourceTypes endpoints
//      (in `./routes`) serialize these to the SCIM 2.0 wire format.

import type { ScimGroupMember } from './types';

// One attribute in a SCIM schema. Mirrors RFC 7643 §7 (Attribute Characteristics) but
// only the fields IdPs actually look at — Okta + Azure AD probe `name`, `type`,
// `multiValued`, `required`, `mutability`. Everything else has sensible defaults.
export type ScimAttributeDefinition = {
	caseExact?: boolean;
	description?: string;
	multiValued?: boolean;
	mutability?: 'immutable' | 'readOnly' | 'readWrite' | 'writeOnly';
	name: string;
	required?: boolean;
	returned?: 'always' | 'default' | 'never' | 'request';
	subAttributes?: ScimAttributeDefinition[];
	type:
		| 'boolean'
		| 'complex'
		| 'dateTime'
		| 'decimal'
		| 'integer'
		| 'reference'
		| 'string';
	uniqueness?: 'global' | 'none' | 'server';
};

// One schema (a namespace + the attributes that live under it). The consumer declares
// these so the /Schemas endpoint can answer the IdP's probe. The package never inspects
// the attribute list at runtime — it's discovery metadata only.
export type ScimSchemaDefinition = {
	attributes: ScimAttributeDefinition[];
	description?: string;
	id: string;
	name: string;
};

// Bidirectional attribute mapping. `fromScim` turns inbound SCIM JSON into a custom-attribute
// bag the consumer's hooks see on `input.custom`; `toScim` turns the same bag back into
// JSON the package merges into the SCIM resource response. Both are optional — declare
// only the schemas you want surfaced via /Schemas + /ResourceTypes.
export type ScimAttributeMap = {
	fromScim: (body: Record<string, unknown>) => Record<string, unknown>;
	schemas?: ScimSchemaDefinition[];
	toScim: (custom: Record<string, unknown>) => Record<string, unknown>;
};

// Identity helper so consumer-side `defineScimAttributeMap({...})` gets full inference +
// the package can document the slot. No runtime behavior beyond pass-through.
export const defineScimAttributeMap = (map: ScimAttributeMap) => map;

export type ScimGroupMembershipDelta = {
	added: ScimGroupMember[];
	removed: ScimGroupMember[];
};

// Diff the previous group membership against the IdP's full-replace list and return
// `{added, removed}`. Used inside `onScimGroupReplace`: read current members → call this
// → apply the deltas to your membership table. Set-based so duplicates within a side
// collapse, and the comparison key is `member.value` (the user's SCIM id).
export const diffScimGroupMembers = (
	current: ScimGroupMember[],
	next: ScimGroupMember[]
): ScimGroupMembershipDelta => {
	const currentValues = new Set(current.map((member) => member.value));
	const nextValues = new Set(next.map((member) => member.value));
	const added = next.filter((member) => !currentValues.has(member.value));
	const removed = current.filter(
		(member) => !nextValues.has(member.value)
	);

	return { added, removed };
};
