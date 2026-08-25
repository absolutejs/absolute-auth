import { consumeSocketTicket } from './oidc/socketTickets';
import {
	resolveAccessTokenPrincipal,
	type AccessTokenPrincipalConfig,
	type AuthPrincipal
} from './principal';
import {
	deriveAuthSyncNamespace,
	readAuthSyncPartition
} from './syncNamespace';

const PWA_SYNC_CLIENT_ID = '@absolutejs/pwa';

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
	/** Resolve only a verified browser session previously derived by Auth. The
	 * caller must independently enforce an exact same-origin request boundary. */
	resolveSession: (input: { authPrincipal?: unknown }) => Promise<
		| {
				context: AbsoluteAuthSyncContext<UserType>;
				namespace: string;
		  }
		| undefined
	>;
};

const toSyncContext = <UserType>(
	authPrincipal: AuthPrincipal<UserType> | undefined
) => (authPrincipal ? { authPrincipal, user: authPrincipal.user } : undefined);

const isSessionAuthPrincipal = <UserType>(
	value: unknown
): value is Extract<AuthPrincipal<UserType>, { kind: 'session' }> =>
	typeof value === 'object' &&
	value !== null &&
	Reflect.get(value, 'kind') === 'session' &&
	typeof Reflect.get(value, 'subject') === 'string' &&
	Reflect.get(value, 'subject').length > 0 &&
	Reflect.has(value, 'user');

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
	),
	resolveSession: async ({ authPrincipal }) => {
		if (!isSessionAuthPrincipal<UserType>(authPrincipal)) return undefined;
		const context = toSyncContext(authPrincipal);
		if (!context) return undefined;

		return {
			context,
				namespace: await deriveAuthSyncNamespace({
				clientId: PWA_SYNC_CLIENT_ID,
				issuer: accessTokens.oidc.issuer,
				partition: readAuthSyncPartition(authPrincipal.user),
				subject: authPrincipal.subject
			})
		};
	}
});
