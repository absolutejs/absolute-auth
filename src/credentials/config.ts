import {
	MILLISECONDS_IN_A_DAY,
	MILLISECONDS_IN_AN_HOUR
} from '../constants';
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
	credentialStore: CredentialStore;
	getUserByEmail: (
		email: string
	) => Promise<UserType | null | undefined> | UserType | null | undefined;
	isMfaRequired?: (user: UserType) => boolean | Promise<boolean>;
	loginRoute?: RouteString;
	onCreateCredentialUser: (
		identity: CredentialIdentity
	) => Promise<Response | StatusReturn | UserType> | Response | StatusReturn | UserType;
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
	resetPasswordRoute?: RouteString;
	resetTokenDurationMs?: number;
	sessionDurationMs?: number;
	verificationTokenDurationMs?: number;
	verifyEmailRoute?: RouteString;
};
