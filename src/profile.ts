import { isValidProviderOption } from 'citra';
import { Elysia } from 'elysia';
import { sessionStore } from './sessionStore';
import {
	ClientProviders,
	OnProfileError,
	OnProfileSuccess,
	RouteString
} from './types';

type ProfileProps = {
	clientProviders: ClientProviders;
	profileRoute?: RouteString;
	onProfileSuccess?: OnProfileSuccess;
	onProfileError?: OnProfileError;
};

export const profile = <UserType>({
	clientProviders,
	profileRoute = '/oauth2/profile',
	onProfileSuccess,
	onProfileError
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
					return error('Unauthorized', 'Client provider not found');
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

					await onProfileSuccess?.({
						authProvider: auth_provider.value,
						userProfile
					});

					return new Response(JSON.stringify(userProfile));
				} catch (err) {
					await onProfileError?.({
						authProvider: auth_provider.value,
						error: err
					});

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
