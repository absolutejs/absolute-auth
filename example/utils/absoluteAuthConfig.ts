import { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import {
	createAuthConfiguration,
	instantiateUserSession,
	isValidProviderOption
} from '../../src';
import { SchemaType, User } from '../db/schema';
import { createUser, getUser } from '../handlers/userHandlers';
import { providerData } from './providerData';
import { providersConfiguration } from './providersConfiguration';

export const absoluteAuthConfig = (db: NeonHttpDatabase<SchemaType>) =>
	createAuthConfiguration<User>({
		providersConfiguration: providersConfiguration,
		onAuthorizeSuccess: ({ authProvider, authorizationUrl }) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			console.log(
				`\nRedirecting to ${providerName} authorization URL:`,
				authorizationUrl.toString()
			);
		},
		onCallbackSuccess: async ({
			authProvider,
			providerInstance,
			tokenResponse,
			userSessionId,
			session
		}) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			console.log(
				`\nSuccesfully authorized OAuth2 with ${providerName} and got token response:`,
				{
					...tokenResponse
				}
			);

			return instantiateUserSession<User>({
				authProvider,
				providerInstance,
				session,
				tokenResponse,
				userSessionId,
				createUser: async (userProfile) => {
					const user = await createUser({
						authProvider,
						db,
						userProfile
					});
					if (user === undefined)
						throw new Error('Failed to create user');

					return user;
				},
				getUser: async (userProfile) => {
					const user = await getUser({
						authProvider,
						db,
						userProfile
					});

					return user;
				}
			});
		},
		onProfileSuccess: ({ authProvider, userProfile }) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			console.log(`\nSuccessfully fetched ${providerName} profile:`, {
				...userProfile
			});
		},
		onRefreshSuccess: ({ authProvider, tokenResponse }) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			console.log(
				`\nSuccessfully refreshed ${providerName} OAuth2 and recieved token response:`,
				{
					...tokenResponse
				}
			);
		},
		onRevocationSuccess: ({ authProvider, tokenToRevoke }) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			console.log(
				`\nSuccessfully revoked ${providerName} token:`,
				tokenToRevoke
			);
		},
		onSignOut: ({ authProvider, userSessionId, session }) => {
			const providerName = isValidProviderOption(authProvider)
				? providerData[authProvider].name
				: authProvider;

			const userSession = session[userSessionId];

			if (userSession === undefined) {
				throw new Error(
					`User session with id ${userSessionId} not found`
				);
			}

			session[userSessionId] = undefined;

			console.log(
				`\nSuccessfully signed out ${providerName} user:`,
				userSession.user
			);
		},
		onStatus: ({ user }) => {
			if (user === null) {
				console.log('\nSuccessfully checked user is not logged in');
			} else {
				console.log(`\nSuccessfully checked user status:`, user);
			}
		}
	});
