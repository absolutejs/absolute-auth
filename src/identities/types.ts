import type { JsonObject } from '../types';

// One way a person signs in: a provider account (`google` + its subject) linked to the
// consumer's user. A user can hold several, so Google, Microsoft and GitHub can all open
// the same account. The pair (provider, providerSubject) belongs to at most one user.
export type AuthIdentity = {
	// `${provider}:${providerSubject}` — stable, and matches the CLI importer's ids.
	id: string;
	provider: string;
	providerSubject: string;
	// The consumer's stable user key (`getUserId`).
	userId: string;
	// Display details captured at link time (email, name). Never used for matching.
	metadata: JsonObject;
	createdAt: number;
	updatedAt: number;
	lastUsedAt?: number;
};

export type LinkIdentityInput = {
	provider: string;
	providerSubject: string;
	userId: string;
	metadata?: JsonObject;
};

export type LinkIdentityResult = {
	identity: AuthIdentity;
	// `already_linked`: this user already had it; nothing changed.
	status: 'linked' | 'already_linked';
};

// Persistence for sign-in identities. `linkIdentity` throws `AuthIdentityConflictError`
// when the identity already belongs to a different user, so the callback can route to
// `onLinkIdentityConflict` instead of silently reporting success.
export type AuthIdentityStore = {
	findIdentity: (
		provider: string,
		providerSubject: string
	) => Promise<AuthIdentity | undefined>;
	getIdentity: (id: string) => Promise<AuthIdentity | undefined>;
	linkIdentity: (input: LinkIdentityInput) => Promise<LinkIdentityResult>;
	listIdentitiesByUser: (userId: string) => Promise<AuthIdentity[]>;
	removeIdentity: (id: string) => Promise<void>;
	touchIdentity: (id: string, usedAt: number) => Promise<void>;
};

export const identityId = (provider: string, providerSubject: string) =>
	`${provider}:${providerSubject}`;
