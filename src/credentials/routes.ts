import { Elysia } from 'elysia';
import type { CredentialRouteProps } from './config';
import { credentialsEmailVerification } from './emailVerification';
import { credentialsLogin } from './login';
import { credentialsPasswordReset } from './passwordReset';
import { credentialsRegister } from './register';

// Composes the email/password routes into one Elysia instance. `auth()` mounts this
// before `protectRoutePlugin` when a `credentials` block is configured.
export const credentialRoutes = <UserType>(
	config: CredentialRouteProps<UserType>
) =>
	new Elysia()
		.use(credentialsRegister(config))
		.use(credentialsEmailVerification(config))
		.use(credentialsLogin(config))
		.use(credentialsPasswordReset(config));
