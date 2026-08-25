import { consumeSocketTicket } from './oidc/socketTickets';
import {
	resolveAccessTokenPrincipal,
	type AccessTokenPrincipalConfig,
	type AuthPrincipal
} from './principal';

/** The context shared by authenticated WebSocket and finite HTTP Sync work. */
export type AbsoluteAuthSyncContext<UserType> = {
	authPrincipal: AuthPrincipal<UserType>;
	user: UserType;
};

/**
 * Capability consumed by @absolutejs/sync without taking a package dependency
 * on Auth. Keeping both credential forms behind one bridge guarantees that a
 * socket ticket and a background bearer token produce the same application
 * context shape.
 */
export type AbsoluteAuthSyncBridge<UserType> = {
	consumeSocketTicket: (input: {
		audience?: string;
		ticket: string;
	}) => Promise<AbsoluteAuthSyncContext<UserType> | undefined>;
	resolveBearer: (input: {
		authorization?: string;
	}) => Promise<AbsoluteAuthSyncContext<UserType> | undefined>;
};

const toSyncContext = <UserType>(
	authPrincipal: AuthPrincipal<UserType> | undefined
) =>
	authPrincipal ? { authPrincipal, user: authPrincipal.user } : undefined;

export const createAbsoluteAuthSyncBridge = <UserType>(
	accessTokens: AccessTokenPrincipalConfig<UserType>
): AbsoluteAuthSyncBridge<UserType> => ({
	consumeSocketTicket: async ({ audience, ticket }) => {
		const store = accessTokens.oidc.socketTicketStore;
		if (!store) return undefined;

		return toSyncContext(
			await consumeSocketTicket({
				audience: audience ?? accessTokens.oidc.issuer,
				getUser: accessTokens.getUser,
				store,
				ticket
			})
		);
	},
	resolveBearer: async ({ authorization }) =>
		toSyncContext(
			await resolveAccessTokenPrincipal({
				authorization,
				config: accessTokens
			})
		)
});
