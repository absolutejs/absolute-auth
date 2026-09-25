import type { OidcRefreshToken, OidcRefreshTokenFamily } from './types';

// Public projection of a family's current token; drops the hash and custom claims.
export const toRefreshFamily = (
	token: OidcRefreshToken
): OidcRefreshTokenFamily => ({
	...(token.audience === undefined ? {} : { audience: token.audience }),
	clientId: token.clientId,
	expiresAt: token.expiresAt,
	familyId: token.familyId,
	issuedAt: token.createdAt,
	scopes: [...token.scopes],
	userId: token.userId
});
