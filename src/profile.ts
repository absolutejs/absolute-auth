import { isValidProviderOption } from 'citra';
import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import { ClientProviders, OnProfile, RouteString } from './types';

type ProfileProps = {
	clientProviders: ClientProviders;
	profileRoute?: RouteString;
	onProfile?: OnProfile;
};

export const profile = <UserType>({
	clientProviders,
	profileRoute = '/oauth2/profile',
	onProfile
}: ProfileProps) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.get(
			profileRoute,
			async ({
				error,
				store: { session },
				cookie: { user_session_id, auth_provider }
			}) => {
				if (
					auth_provider === undefined ||
					user_session_id === undefined
				)
					return error('Bad Request', 'Cookies are missing');

				if (auth_provider.value === undefined) {
					return error('Unauthorized', 'No auth provider found');
				}

				if (!isValidProviderOption(auth_provider.value)) {
					return error('Unauthorized', 'Invalid provider');
				}

				if (user_session_id.value === undefined) {
					return error('Unauthorized', 'No user session found');
				}

				const providerConfig = clientProviders[auth_provider.value];
				if (!providerConfig) {
					return error('Unauthorized', 'Invalid provider');
				}
				const { providerInstance } = providerConfig;

				const userSession = session[user_session_id.value];

				if (userSession === undefined) {
					return error('Unauthorized', 'No user session found');
				}

				const { accessToken } = userSession;

				try {
					const userProfile =
						await providerInstance.fetchUserProfile(accessToken);

					await onProfile?.({
						userProfile
					});

					return new Response(JSON.stringify(userProfile));
				} catch (err) {
					return err instanceof Error
						? error(
								'Internal Server Error',
								`${err.message} - ${err.stack ?? ''}`
							)
						: error(
								'Internal Server Error',
								`Failed to validate authorization code: Unknown error: ${err}`
							);
				}
			}
		);
