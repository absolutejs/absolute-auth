import Elysia from 'elysia';
import { OAuthEventHandler } from './types';
import { sessionStore } from './sessionStore';

type StatusProps = {
	statusRoute?: string;
	onStatus?: OAuthEventHandler;
};

export const status = <UserType>({
	statusRoute = 'auth-status',
	onStatus
}: StatusProps) => {
	return new Elysia()
		.use(sessionStore<UserType>())
		.get(
			`/${statusRoute}`,
			async ({
				error,
				cookie: { user_session_id, auth_provider },
				store: { session }
			}) => {
				try {
					if (user_session_id.value === undefined) {
						return new Response(JSON.stringify({ user: null }), {
							headers: { 'Content-Type': 'application/json' }
						});
					}

					if (auth_provider.value === undefined) {
						return new Response(JSON.stringify({ user: null }), {
							headers: { 'Content-Type': 'application/json' }
						});
					}

					const userSession = session[user_session_id.value];

					if (userSession === undefined) {
						return new Response(JSON.stringify({ user: null }), {
							headers: { 'Content-Type': 'application/json' }
						});
					}

					const user = userSession.user;

					onStatus?.();

					return new Response(JSON.stringify({ user }), {
						headers: { 'Content-Type': 'application/json' }
					});
				} catch (err) {
					if (err instanceof Error) {
						console.error(
							'Failed to get auth status: ',
							err.message
						);
					}

					return error(500);
				}
			}
		);
};
