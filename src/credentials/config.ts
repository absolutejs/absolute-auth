import { MILLISECONDS_IN_A_DAY, MILLISECONDS_IN_AN_HOUR } from '../constants';
import type { LockoutGuard } from '../lockout/config';
import type { AuthSessionStore } from '../session/types';
import type { OrganizationId } from '../tenancy';
import type { RouteString, StatusReturn, UserSessionId } from '../types';
import type { PasswordPolicy } from './passwordPolicy';
import type { CredentialStore } from './types';

export const DEFAULT_CREDENTIAL_SESSION_TTL_MS = MILLISECONDS_IN_A_DAY;
export const DEFAULT_RESET_TOKEN_TTL_MS = MILLISECONDS_IN_AN_HOUR;
export const DEFAULT_VERIFICATION_TOKEN_TTL_MS = MILLISECONDS_IN_A_DAY;

export type CredentialIdentity = {
	email: string;
	organizationId?: OrganizationId;
};

export type CredentialEmailType = 'reset_password' | 'verify_email';

export type CredentialEmailMessage = {
	email: string;
	expiresAt: number;
	token: string;
	type: CredentialEmailType;
};

// The consumer owns the user table; the package asks for users through these hooks and
// owns only password hashes + tokens via `credentialStore`. Every block is additive and
// routes are overridable, matching the existing OAuth config surface.
export type CredentialsConfig<UserType> = {
	// When true, a successful login also checks the password against HIBP; if it
	// has since appeared in a breach the session is still issued but the response
	// carries `passwordCompromised: true` so the consumer can force a reset.
	checkBreachesOnLogin?: boolean;
	credentialStore: CredentialStore;
	getUserByEmail: (
		email: string
	) => Promise<UserType | null | undefined> | UserType | null | undefined;
	// Decide whether this user must complete an MFA challenge before the session is
	// promoted. Receives request context (IP, UA, Cloudflare headers, etc.) so the
	// consumer can adapt the gate to the request — e.g. always require MFA when
	// `scoreRisk(...)` says the login is unusual, while letting trusted devices skip.
	// Original `(user) => boolean` signatures keep working unchanged because the new
	// `context` is the optional second positional argument.
	isMfaRequired?: (
		user: UserType,
		context?: { headers: Record<string, string | undefined>; ip?: string }
	) => boolean | Promise<boolean>;
	// Optional custom password verifier — overrides the default `Bun.password.verify`
	// (which already handles argon2id + bcrypt natively). Wire this when imported
	// credentials use a non-bcrypt/argon2 algorithm (Auth0 PBKDF2, AWS Cognito
	// SHA-256, scrypt, …) — see `legacyHashers.ts` for shipped helpers.
	passwordVerifier?: (
		plainPassword: string,
		storedHash: string
	) => Promise<boolean>;
	// When true, after a successful login against a stored hash that is NOT native
	// Argon2id or bcrypt, re-hash the plaintext with Argon2id + save it back to the
	// credential store. Lets imported users transparently migrate to the native hash
	// on their next sign-in.
	rehashOnLogin?: boolean;
	loginRoute?: RouteString;
	// `identity` carries the normalized email plus any extra register-body fields
	// (e.g. given_name) the consumer's signup form sends — read them off `identity`.
	onCreateCredentialUser: (
		identity: CredentialIdentity & Record<string, unknown>
	) =>
		| Promise<Response | StatusReturn | UserType>
		| Response
		| StatusReturn
		| UserType;
	onCredentialsLoginError?: (context: {
		email: string;
		error: unknown;
	}) => void | Promise<void>;
	onCredentialsLoginSuccess?: (context: {
		user: UserType;
		userSessionId: UserSessionId;
	}) => void | Promise<void>;
	onEmailVerified?: (context: { email: string }) => void | Promise<void>;
	onPasswordReset?: (context: { email: string }) => void | Promise<void>;
	onRegistrationSuccess?: (context: {
		email: string;
		user: UserType;
	}) => void | Promise<void>;
	onSendEmail: (message: CredentialEmailMessage) => void | Promise<void>;
	passwordPolicy?: PasswordPolicy;
	registerRoute?: RouteString;
	/** When true, registration creates the account but NOT a session, and login is
	 *  rejected until the email is verified. Default false = auto-login on register and
	 *  verification acts as a soft, later gate. */
	requireEmailVerification?: boolean;
	resetPasswordRoute?: RouteString;
	resetTokenDurationMs?: number;
	sessionDurationMs?: number;
	verificationTokenDurationMs?: number;
	verifyEmailRoute?: RouteString;
};

// The route modules also need the top-level `authSessionStore` (threaded in by `auth()`)
// to persist promoted sessions, so they accept this superset of the public config.
export type CredentialRouteProps<UserType> = CredentialsConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
	lockoutGuard?: LockoutGuard;
};
