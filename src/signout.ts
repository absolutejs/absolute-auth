import { Elysia } from 'elysia';

type SignOutProps = {
	signoutRoute?: string;
	onSignOut?: () => void;
};

export const signout = ({
	signoutRoute = 'signout',
	onSignOut
}: SignOutProps) =>
	new Elysia().post(
		`/${signoutRoute}`,
		async ({ error, cookie: { user_session_id, auth_provider } }) => {
			if (auth_provider.value === undefined) {
				return error('Unauthorized', 'No auth provider found');
			}

			try {
				onSignOut?.();

				user_session_id.remove();
				auth_provider.remove();

				return new Response('Succesfuly Logged Out', {
					status: 204
				});
			} catch (err) {
				if (err instanceof Error) {
					return error(
						'Internal Server Error',
						`Failed to signout: ${err.message}`
					);
				}

				return error(
					'Internal Server Error',
					`Failed to signout: Unknown error: ${err}`
				);
			}
		}
	);
