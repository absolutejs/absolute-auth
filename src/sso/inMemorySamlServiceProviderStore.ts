import type { SamlServiceProvider, SamlServiceProviderStore } from './types';

export const createInMemorySamlServiceProviderStore =
	(): SamlServiceProviderStore => {
		const providers = new Map<string, SamlServiceProvider>();

		return {
			deleteServiceProvider: async (entityId) => {
				providers.delete(entityId);
			},
			findServiceProvider: async (entityId) => {
				const found = providers.get(entityId);

				return found ? { ...found } : undefined;
			},
			listServiceProviders: async () =>
				Array.from(providers.values()).map((serviceProvider) => ({
					...serviceProvider
				})),
			saveServiceProvider: async (serviceProvider) => {
				providers.set(serviceProvider.entityId, { ...serviceProvider });
			}
		};
	};
