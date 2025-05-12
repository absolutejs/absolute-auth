import { isRefreshableOAuth2Client } from 'citra';
import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import { ClientProviders } from './types';

type StatusProps = {
	clientProviders: ClientProviders;
	statusRoute?: string;
	onStatus?: () => void;
};

export const status = <UserType>({
	clientProviders,
	statusRoute = 'auth-status',
	onStatus
}: StatusProps) =>
	new Elysia()
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
						return new Response(
							JSON.stringify({ isLoggedIn: false, user: null }),
							{
								headers: { 'Content-Type': 'application/json' }
							}
						);
					}

					if (auth_provider.value === undefined) {
						return new Response(
							JSON.stringify({ isLoggedIn: false, user: null }),
							{
								headers: { 'Content-Type': 'application/json' }
							}
						);
					}

					const normalizedProvider =
						auth_provider.value.toLowerCase();
					const { providerInstance } =
						clientProviders[normalizedProvider];

					// Returns an error if the provider is not refreshable but
					// consider another approach to be more inclusive of providers
					if (
						!isRefreshableOAuth2Client('Google', providerInstance)
					) {
						return error(
							'Not Implemented',
							'Provider is not refreshable'
						);
					}

					const userSession = session[user_session_id.value];

					// Return null because the user is not logged in, its not an error just a status
					if (userSession === undefined) {
						return new Response(
							JSON.stringify({ isLoggedIn: false, user: null }),
							{
								headers: { 'Content-Type': 'application/json' }
							}
						);
					}

					const { user } = userSession;

					onStatus?.();

					return new Response(
						JSON.stringify({ isLoggedIn: true, user }),
						{
							headers: { 'Content-Type': 'application/json' }
						}
					);
				} catch (err) {
					if (err instanceof Error) {
						return error(
							'Internal Server Error',
							`Error: ${err.message} - ${err.stack ?? ''}`
						);
					}

					return error(
						'Internal Server Error',
						`Unknown Error: ${err}`
					);
				}
			}
		);
