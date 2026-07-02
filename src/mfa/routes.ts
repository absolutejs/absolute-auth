import { Elysia } from 'elysia';
import { mfaChallenge } from './challenge';
import type { MfaRouteProps } from './config';
import { mfaSmsRoutes } from './sms';
import { mfaTotpRoutes } from './totp';

// Composes the MFA routes (TOTP setup/verify + SMS setup/verify + challenge) into one Elysia
// instance. `auth()` mounts this before `protectRoutePlugin` when an `mfa` block is configured.
export const mfaRoutes = <UserType>(config: MfaRouteProps<UserType>) =>
	new Elysia()
		.use(mfaTotpRoutes(config))
		.use(mfaSmsRoutes(config))
		.use(mfaChallenge(config));
