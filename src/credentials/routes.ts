import { Elysia } from 'elysia';
import type { AuthSessionStore } from '../session/types';
import type { CredentialsConfig } from './config';
import { credentialsEmailVerification } from './emailVerification';
import { credentialsLogin } from './login';
import { credentialsPasswordReset } from './passwordReset';
import { credentialsRegister } from './register';

// Composes the email/password routes into one Elysia instance. `auth()` mounts this
// before `protectRoutePlugin` when a `credentials` block is configured.
export const credentialRoutes = <UserType>(
	config: CredentialsConfig<UserType> & {
		authSessionStore?: AuthSessionStore<UserType>;
	}
) =>
	new Elysia()
		.use(credentialsRegister(config))
		.use(credentialsEmailVerification(config))
		.use(credentialsLogin(config))
		.use(credentialsPasswordReset(config));
