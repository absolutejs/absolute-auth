import { Elysia } from 'elysia';

type LogoutProps = {
	logoutRoute?: string;
	onLogout?: () => void;
};

export const logout = ({ logoutRoute = 'logout', onLogout }: LogoutProps) =>
	new Elysia().post(
		`/${logoutRoute}`,
		async ({ error, cookie: { user_session_id, auth_provider } }) => {
			if (auth_provider.value === undefined) {
				return error('Unauthorized', 'No auth provider found');
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
					return error(
						'Internal Server Error',
						`Failed to logout: ${err.message}`
					);
				}

				return error(
					'Internal Server Error',
					`Failed to logout: Unknown error: ${err}`
				);
			}
		}
	);
