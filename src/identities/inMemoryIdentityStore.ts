import { AuthIdentityConflictError } from '../errors';
import { identityId, type AuthIdentity, type AuthIdentityStore } from './types';

const clone = (identity: AuthIdentity): AuthIdentity => ({
	...identity,
	metadata: structuredClone(identity.metadata)
});

export const createInMemoryIdentityStore = (): AuthIdentityStore => {
	const identities = new Map<string, AuthIdentity>();

	return {
		findIdentity: async (provider, providerSubject) => {
			const found = identities.get(identityId(provider, providerSubject));

			return found ? clone(found) : undefined;
		},
		getIdentity: async (id) => {
			const found = identities.get(id);

			return found ? clone(found) : undefined;
		},
		linkIdentity: async ({
			metadata = {},
			provider,
			providerSubject,
			userId
		}) => {
			const id = identityId(provider, providerSubject);
			const existing = identities.get(id);
			if (existing && existing.userId !== userId)
				throw new AuthIdentityConflictError({
					authProvider: provider,
					currentUserAuthSub: userId,
					existingUserAuthSub: existing.userId,
					providerSubject
				});
			if (existing)
				return { identity: clone(existing), status: 'already_linked' };
			const now = Date.now();
			const identity: AuthIdentity = {
				createdAt: now,
				id,
				metadata: structuredClone(metadata),
				provider,
				providerSubject,
				updatedAt: now,
				userId
			};
			identities.set(id, identity);

			return { identity: clone(identity), status: 'linked' };
		},
		listIdentitiesByUser: async (userId) =>
			[...identities.values()]
				.filter((identity) => identity.userId === userId)
				.sort((first, second) => first.createdAt - second.createdAt)
				.map(clone),
		removeIdentity: async (id) => {
			identities.delete(id);
		},
		touchIdentity: async (id, usedAt) => {
			const found = identities.get(id);
			if (found) found.lastUsedAt = usedAt;
		}
	};
};
