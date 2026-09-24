import type {
	LinkedProviderGrant,
	LinkedProviderGrantStore
} from '@absolutejs/linked-providers';
import type { SecretCipher } from '../compliance/cipher';

type TokenField = 'accessTokenCiphertext' | 'refreshTokenCiphertext';
/** Wrap the raw persistent store once. Only this server-side view exposes plaintext
 * to the OAuth resolver; raw rows stay encrypted and bound to their owner/grant. */
export const createEncryptedLinkedProviderGrantStore = ({
	store,
	cipher
}: {
	store: LinkedProviderGrantStore;
	cipher: SecretCipher;
}): LinkedProviderGrantStore => {
	const context = (grant: LinkedProviderGrant, field: TokenField) =>
		JSON.stringify([
			grant.id,
			grant.ownerRef,
			grant.authProviderKey,
			grant.providerSubject,
			field
		]);
	const token = async (
		grant: LinkedProviderGrant,
		field: TokenField,
		encrypt: boolean
	) => {
		const value = grant[field];
		if (value === undefined) return undefined;
		if (encrypt)
			return cipher.encrypt(
				JSON.stringify({ context: context(grant, field), token: value })
			);
		const decoded: unknown = JSON.parse(await cipher.decrypt(value));
		if (
			!decoded ||
			typeof decoded !== 'object' ||
			!('context' in decoded) ||
			decoded.context !== context(grant, field) ||
			!('token' in decoded) ||
			typeof decoded.token !== 'string'
		)
			throw new Error('Linked credential envelope mismatch');

		return decoded.token;
	};
	const transform = async (grant: LinkedProviderGrant, encrypt: boolean) => ({
		...grant,
		accessTokenCiphertext: await token(
			grant,
			'accessTokenCiphertext',
			encrypt
		),
		refreshTokenCiphertext: await token(
			grant,
			'refreshTokenCiphertext',
			encrypt
		)
	});

	return {
		getGrant: async (id) => {
			const grant = await store.getGrant(id);

			return grant ? transform(grant, false) : undefined;
		},
		listGrantsByOwner: async (owner) =>
			Promise.all(
				(await store.listGrantsByOwner(owner)).map((grant) =>
					transform(grant, false)
				)
			),
		removeGrant: async (id) => {
			if (!store.removeGrant)
				throw new Error('Grant removal is not supported');
			await store.removeGrant(id);
		},
		saveGrant: async (grant) =>
			store.saveGrant(await transform(grant, true))
	};
};
