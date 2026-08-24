import { signingVerificationKeys, verifyJwtWithKeys } from './oidc/keys';
import type { OidcProviderConfig } from './oidc/config';

export type AuthPrincipal<UserType> =
	| {
			kind: 'access-token';
			audience: string;
			clientId: string;
			scopes: string[];
			subject: string;
			user: UserType;
	  }
	| {
			kind: 'session';
			subject: string;
			user: UserType;
	  };

export type AccessTokenPrincipalConfig<UserType> = {
	audience?: string;
	getUser: (subject: string) => Promise<UserType | null> | UserType | null;
	oidc: OidcProviderConfig<UserType>;
};

export type VerifiedAccessToken = {
	audience: string;
	clientId: string;
	scopes: string[];
	subject: string;
};

const readBearer = (authorization: string | undefined) => {
	const match = authorization?.match(/^Bearer ([^\s]+)$/iu);

	return match?.[1];
};

const includesAudience = (value: unknown, expected: string) =>
	value === expected ||
	(Array.isArray(value) && value.some((entry) => entry === expected));

/** Resolve a mobile/public-client access token into the same typed application
 * user carried by a browser session. DPoP-bound tokens fail closed until the
 * resource proof verifier is enabled in the next hardening phase. */
export const resolveAccessTokenPrincipal = async <UserType>({
	authorization,
	config,
	now = Date.now()
}: {
	authorization?: string;
	config: AccessTokenPrincipalConfig<UserType>;
	now?: number;
}): Promise<AuthPrincipal<UserType> | undefined> => {
	const verified = await verifyOidcAccessToken({
		audience: config.audience,
		authorization,
		now,
		oidc: config.oidc
	});
	if (!verified) return undefined;
	const user = await config.getUser(verified.subject);
	if (user === null) return undefined;

	return { ...verified, kind: 'access-token', user };
};

/** Verify an Absolute OAuth access token without resolving its application user. */
export const verifyOidcAccessToken = async <UserType>({
	authorization,
	audience,
	now = Date.now(),
	oidc
}: {
	authorization?: string;
	audience?: string;
	now?: number;
	oidc: OidcProviderConfig<UserType>;
}): Promise<VerifiedAccessToken | undefined> => {
	const token = readBearer(authorization);
	if (!token) return undefined;
	const jwt = await verifyJwtWithKeys(
		token,
		signingVerificationKeys(oidc.signingKey, oidc.previousSigningKeys)
	);
	const payload = jwt?.payload;
	const expectedAudience = audience ?? oidc.issuer;
	if (
		payload === undefined ||
		payload.iss !== oidc.issuer ||
		payload.token_use !== 'access' ||
		typeof payload.exp !== 'number' ||
		payload.exp * 1000 <= now ||
		typeof payload.sub !== 'string' ||
		typeof payload.client_id !== 'string' ||
		typeof payload.scope !== 'string' ||
		!includesAudience(payload.aud, expectedAudience) ||
		payload.cnf !== undefined
	)
		return undefined;

	return {
		audience: expectedAudience,
		clientId: payload.client_id,
		scopes: payload.scope.split(' ').filter(Boolean),
		subject: payload.sub
	};
};
