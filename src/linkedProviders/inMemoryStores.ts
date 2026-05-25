import type {
	LinkedProviderBinding,
	LinkedProviderBindingStore,
	LinkedProviderGrant,
	LinkedProviderGrantStore
} from '@absolutejs/linked-providers';

export type CreateInMemoryLinkedProviderStoresOptions = {
	grants?: LinkedProviderGrant[];
	bindings?: LinkedProviderBinding[];
};

const cloneGrant = (grant: LinkedProviderGrant): LinkedProviderGrant => ({
	...grant,
	grantedScopes: [...grant.grantedScopes],
	metadata: grant.metadata ? { ...grant.metadata } : undefined
});

const cloneBinding = (
	binding: LinkedProviderBinding
): LinkedProviderBinding => ({
	...binding,
	availableScopes: [...binding.availableScopes],
	capabilities: binding.capabilities ? [...binding.capabilities] : undefined,
	metadata: binding.metadata ? { ...binding.metadata } : undefined
});

export const createInMemoryLinkedProviderStores = (
	input: CreateInMemoryLinkedProviderStoresOptions = {}
): {
	grantStore: LinkedProviderGrantStore;
	bindingStore: LinkedProviderBindingStore;
} => {
	const grants = new Map<string, LinkedProviderGrant>(
		(input.grants ?? []).map((grant) => [grant.id, cloneGrant(grant)])
	);
	const bindings = new Map<string, LinkedProviderBinding>(
		(input.bindings ?? []).map((binding) => [
			binding.id,
			cloneBinding(binding)
		])
	);

	const grantStore: LinkedProviderGrantStore = {
		getGrant: async (id) => {
			const grant = grants.get(id);
			return grant ? cloneGrant(grant) : undefined;
		},
		listGrantsByOwner: async (ownerRef) =>
			[...grants.values()]
				.filter((grant) => grant.ownerRef === ownerRef)
				.map(cloneGrant),
		saveGrant: async (grant) => {
			grants.set(grant.id, cloneGrant(grant));
		},
		removeGrant: async (id) => {
			grants.delete(id);
			for (const [bindingId, binding] of bindings.entries()) {
				if (binding.grantId === id) {
					bindings.delete(bindingId);
				}
			}
		}
	};

	const bindingStore: LinkedProviderBindingStore = {
		getBinding: async (id) => {
			const binding = bindings.get(id);
			return binding ? cloneBinding(binding) : undefined;
		},
		listBindingsByOwner: async (ownerRef) =>
			[...bindings.values()]
				.filter(
					(binding) =>
						grants.get(binding.grantId)?.ownerRef === ownerRef
				)
				.map(cloneBinding),
		listBindingsByGrant: async (grantId) =>
			[...bindings.values()]
				.filter((binding) => binding.grantId === grantId)
				.map(cloneBinding),
		saveBinding: async (binding) => {
			bindings.set(binding.id, cloneBinding(binding));
		},
		removeBinding: async (id) => {
			bindings.delete(id);
		}
	};

	return { grantStore, bindingStore };
};
