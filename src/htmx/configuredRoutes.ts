import { Elysia } from 'elysia';
import type { SessionData } from '../types';
import type { AuthSessionSource, AuthSessionStore } from '../session/types';
import { createAuthHtmxRoutes } from './routes';
import type { AuthHtmxConfig, AuthHtmxUser } from './types';

const isNullableString = (value: unknown) =>
	value === undefined || value === null || typeof value === 'string';

const isAuthHtmxUser = (value: unknown): value is AuthHtmxUser => {
	if (typeof value !== 'object' || value === null) return false;

	return (
		typeof Reflect.get(value, 'sub') === 'string' &&
		isNullableString(Reflect.get(value, 'email')) &&
		isNullableString(Reflect.get(value, 'first_name')) &&
		isNullableString(Reflect.get(value, 'last_name')) &&
		isNullableString(Reflect.get(value, 'primary_auth_identity_id'))
	);
};

const htmxSessionSource = <UserType>(
	store?: AuthSessionStore<UserType>
): AuthSessionSource<AuthHtmxUser> | undefined => {
	if (store === undefined) return undefined;

	return {
		getSession: async (id) => {
			const session = await store.getSession(id);
			if (session === undefined || !isAuthHtmxUser(session.user)) {
				return undefined;
			}

			const result: SessionData<AuthHtmxUser> = {
				...session,
				user: session.user
			};

			return result;
		},
		removeSession: (id) => store.removeSession(id)
	};
};

export const createConfiguredAuthHtmxRoutes = <UserType>({
	authSessionStore,
	config
}: {
	authSessionStore?: AuthSessionStore<UserType>;
	config?: AuthHtmxConfig;
}) =>
	config === undefined
		? new Elysia()
		: createAuthHtmxRoutes<AuthHtmxUser>({
				...config,
				authSessionStore: htmxSessionSource(authSessionStore)
			});
