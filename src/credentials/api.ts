import { Elysia } from 'elysia';
import type { CredentialRouteProps } from './config';
import { credentialsLoginRoute } from './login';
import { credentialsRegisterRoute } from './register';
import { credentialsEmailVerificationRoute } from './emailVerification';
import { credentialsPasswordResetRoute } from './passwordReset';

/** Fixed routes preserve Eden's route and body inference. The application owns
 * users, durable stores and email delivery; all credential policy stays in the
 * existing package handlers. Mount this instead of auth's credentials block. */
export const createCredentialsApi = <UserType>(
	configuration: Omit<
		CredentialRouteProps<UserType>,
		| 'loginRoute'
		| 'registerRoute'
		| 'verifyEmailRoute'
		| 'resetPasswordRoute'
	>
) =>
	new Elysia()
		.use(
			credentialsRegisterRoute({
				...configuration,
				registerRoute: '/auth/register'
			})
		)
		.use(
			credentialsLoginRoute({
				...configuration,
				loginRoute: '/auth/login'
			})
		)
		.use(
			credentialsEmailVerificationRoute({
				...configuration,
				verifyEmailRoute: '/auth/verify-email'
			})
		)
		.use(
			credentialsPasswordResetRoute({
				...configuration,
				resetPasswordRoute: '/auth/reset-password'
			})
		);
