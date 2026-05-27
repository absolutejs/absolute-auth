// In-memory CredentialOfferStore + CredentialNonceStore for VCI. Postgres flavors will land
// in a later beta — these match the "default ephemeral, swap in for prod" pattern the rest of
// the package uses (in-mem sessions, in-mem DPoP nonces, etc.).

import type {
	CredentialNonceRecord,
	CredentialNonceStore,
	CredentialOffer,
	CredentialOfferStore
} from './vci';

export const createInMemoryCredentialNonceStore = (): CredentialNonceStore => {
	const nonces = new Map<string, CredentialNonceRecord>();

	return {
		consumeNonce: async (nonceHash) => {
			const record = nonces.get(nonceHash);
			if (record === undefined) return undefined;
			nonces.delete(nonceHash);

			return record;
		},
		saveNonce: async (record) => {
			nonces.set(record.nonceHash, record);
		}
	};
};
export const createInMemoryCredentialOfferStore = (): CredentialOfferStore => {
	const offers = new Map<string, CredentialOffer>();

	return {
		consumeOffer: async (preAuthorizedCodeHash) => {
			const offer = offers.get(preAuthorizedCodeHash);
			if (offer === undefined) return undefined;
			offers.set(preAuthorizedCodeHash, { ...offer, redeemed: true });

			return offer;
		},
		saveOffer: async (offer) => {
			offers.set(offer.preAuthorizedCodeHash, offer);
		}
	};
};
