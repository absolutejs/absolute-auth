import { eq } from 'drizzle-orm';
import type { LinkedProviderCredentialResolver } from '@absolutejs/linked-providers';
import type { AnyPgDatabase } from '../stores/postgres';
import type { SecretCipher } from '../compliance/cipher';
import type { OAuth2ConfigurationOptions } from '../types';
import { createEncryptedLinkedProviderGrantStore } from './encryptedStore';
import {
	createLinkedProviderBindingStore,
	createLinkedProviderGrantStore,
	linkedProviderGrantsTable
} from './neonStores';
import { createOAuthLinkedProviderCredentialResolver } from './oauthResolver';

/** Interactive transactions are required; never pass a Neon HTTP batch here.
 * The grant row lock serializes renewals with deletion/replacement across processes.
 * Refresh failures commit their safe recovery state before being rethrown.
 * Provider actions happen AFTER this transaction, so a later action failure cannot
 * roll back a rotated refresh token. Already dispatched requests cannot be recalled.
 */
export const createCoordinatedOAuthLinkedProviderCredentialResolver = <
	DB extends AnyPgDatabase
>(options: {
	transaction: <T>(work: (db: DB) => Promise<T>) => Promise<T>;
	cipher: SecretCipher;
	providersConfiguration: OAuth2ConfigurationOptions;
}): LinkedProviderCredentialResolver => {
	const run = async <T>(
		grantId: string | undefined,
		work: (resolver: LinkedProviderCredentialResolver) => Promise<T>
	) => {
		const result = await options.transaction(async (db) => {
			if (grantId !== undefined) {
				await db
					.select({ id: linkedProviderGrantsTable.id })
					.from(linkedProviderGrantsTable)
					.where(eq(linkedProviderGrantsTable.id, grantId))
					.for('update');
			}
			const resolver = await createOAuthLinkedProviderCredentialResolver({
				bindingStore: createLinkedProviderBindingStore(db),
				grantStore: createEncryptedLinkedProviderGrantStore({
					cipher: options.cipher,
					store: createLinkedProviderGrantStore(db)
				}),
				providersConfiguration: options.providersConfiguration
			});
			try {
				return { ok: true as const, value: await work(resolver) };
			} catch (error) {
				return { error, ok: false as const };
			}
		});
		if (!result.ok) throw result.error;

		return result.value;
	};

	return {
		getAccessToken: (credential, input) =>
			run(credential.grantId, async (resolver) =>
				resolver.getAccessToken(credential, input)
			),
		listBindings: (input) =>
			run(undefined, async (resolver) => resolver.listBindings(input)),
		reportFailure: (credential, report) =>
			run(credential.grantId, async (resolver) =>
				resolver.reportFailure(credential, report)
			),
		resolveCredential: (input) =>
			run(undefined, async (resolver) =>
				resolver.resolveCredential(input)
			)
	};
};
