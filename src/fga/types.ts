// Fine-grained authorization (ReBAC) — the WorkOS FGA / Google Zanzibar model. Permissions are
// relationship tuples ("warrants"): a subject has a `relation` on a resource. Rules let
// relations inherit (an editor is also a viewer; a folder's viewers view its docs), so you
// don't write a warrant for every permission. `check` answers "does X have R on Y?";
// `listSubjects` answers "who has R on Y?".

// A relationship tuple. The subject is a user (subjectRelation omitted) or a userset — the
// members of `subjectType:subjectId#subjectRelation` (e.g. group:eng#member).
export type Warrant = {
	relation: string;
	resourceId: string;
	resourceType: string;
	subjectId: string;
	subjectRelation?: string;
	subjectType: string;
};

export type WarrantStore = {
	deleteWarrant: (warrant: Warrant) => Promise<void>;
	// Warrants written directly on (resourceType, resourceId, relation).
	listForResource: (
		resourceType: string,
		resourceId: string,
		relation: string
	) => Promise<Warrant[]>;
	// Distinct resource ids of a type across all warrants — the candidate set `listObjects`
	// filters with `check` (any resource the subject can reach appears here as a resource).
	listResourceIds: (resourceType: string) => Promise<string[]>;
	saveWarrant: (warrant: Warrant) => Promise<void>;
};

// How a relation is derived. Default (a relation with no rule) is `self` — direct warrants only.
//  - self:             direct warrants (incl. userset subjects, expanded recursively)
//  - computedUserset:  also everyone with `relation` on the SAME resource (editor ⊇ viewer)
//  - tupleToUserset:   also everyone with `relation` on a resource reached via `viaRelation`
//                      (doc viewers ⊇ viewers of the doc's parent folder)
//  - union:            any of the sub-rules
export type RelationRule =
	| { kind: 'computedUserset'; relation: string }
	| { kind: 'self' }
	| { kind: 'tupleToUserset'; relation: string; viaRelation: string }
	| { kind: 'union'; rules: RelationRule[] };

// resourceType -> relation -> rule.
export type FgaSchema = Record<string, Record<string, RelationRule>>;
