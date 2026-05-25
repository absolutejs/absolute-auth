import type { AuditEmitter } from '../audit/config';
import { MILLISECONDS_IN_A_DAY, MILLISECONDS_IN_A_SECOND } from '../constants';
import type { AuthSessionStore } from '../session/types';
import type { RouteString, UserSessionId } from '../types';
import type { PasswordlessTokenStore } from './types';

const SECONDS_IN_TEN_MINUTES = 600;
const DEFAULT_OTP_DIGITS = 6;

export const DEFAULT_MAGIC_LINK_TTL_MS =
	MILLISECONDS_IN_A_SECOND * SECONDS_IN_TEN_MINUTES;
export const DEFAULT_OTP_LENGTH = DEFAULT_OTP_DIGITS;
export const DEFAULT_OTP_TTL_MS =
	MILLISECONDS_IN_A_SECOND * SECONDS_IN_TEN_MINUTES;
export const DEFAULT_PASSWORDLESS_ROUTE: RouteString = '/auth/passwordless';
export const DEFAULT_PASSWORDLESS_SESSION_TTL_MS = MILLISECONDS_IN_A_DAY;

export type MagicLinkMessage = {
	email: string;
	expiresAt: number;
	// The single-use plaintext token; embed it in the link to your verify page.
	token: string;
};

export type PasswordlessOtpMessage = {
	// The single-use plaintext code to read back to the user.
	code: string;
	email: string;
	expiresAt: number;
};

// Passwordless login (magic links + email/SMS OTP). Additive and optional. The magic-link flow
// mounts only when `onSendMagicLink` is set; the OTP flow only when `onSendOtp` is set (the token
// is delivered out-of-band — never returned from the request route, since it is unauthenticated).
// Both verify routes mint the same `SessionData<UserType>` as every other flow.
export type PasswordlessConfig<UserType> = {
	// Resolve the email to a user. Return null/undefined to fall back to `onCreateUser` (or reject).
	getUserByEmail: (
		email: string
	) => Promise<UserType | null | undefined> | UserType | null | undefined;
	passwordlessTokenStore: PasswordlessTokenStore;
	// Stable per-user key, used only to label the audit event when present.
	getUserId?: (user: UserType) => string;
	magicLinkTokenDurationMs?: number;
	// Create the user on first passwordless login (signup). When omitted, an unknown email is
	// rejected at verify.
	onCreateUser?: (context: { email: string }) => Promise<UserType> | UserType;
	onPasswordlessLogin?: (context: {
		user: UserType;
		userSessionId: UserSessionId;
	}) => void | Promise<void>;
	onSendMagicLink?: (message: MagicLinkMessage) => void | Promise<void>;
	onSendOtp?: (message: PasswordlessOtpMessage) => void | Promise<void>;
	otpDurationMs?: number;
	otpLength?: number;
	passwordlessRoute?: RouteString;
	sessionDurationMs?: number;
};

export type PasswordlessRouteProps<UserType> = PasswordlessConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
	emit?: AuditEmitter;
};
