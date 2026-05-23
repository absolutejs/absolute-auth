import { createNeonOAuthLinkedProviderCredentialResolver } from '../../src';
import { providersConfiguration } from '../utils/providersConfiguration';

export const createExampleLinkedProviderCredentialResolver = async (
	databaseUrl: string
) =>
	createNeonOAuthLinkedProviderCredentialResolver({
		databaseUrl,
		providersConfiguration
	});
