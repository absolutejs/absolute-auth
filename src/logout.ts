import Elysia from 'elysia';
import { OAuthEventHandler } from './types';

type LogoutProps = {
	logoutRoute?: string;
	onLogout?: OAuthEventHandler;
};

export const logout = ({ logoutRoute = 'logout', onLogout }: LogoutProps) => {
	return new Elysia().post(
		`/${logoutRoute}`,
		async ({ error, cookie: { user_session_id, auth_provider } }) => {
			if (auth_provider.value === undefined) {
				return error(401, 'No auth provider found');
			}

			try {
				onLogout?.();

				user_session_id.remove();
				auth_provider.remove();

				return new Response('Succesfuly Logged Out', {
					status: 204
				});
			} catch (err) {
				if (err instanceof Error) {
					console.error('Failed to refresh token:', err.message);
				}

				return error(500);
			}
		}
	);
};
