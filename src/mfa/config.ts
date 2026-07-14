import {
	MILLISECONDS_IN_A_DAY,
	MILLISECONDS_IN_A_SECOND,
	SECONDS_IN_A_MINUTE
} from '../constants';
import type { AuthSessionStore } from '../session/types';
import type { RouteString, UserSessionId } from '../types';
import type { MFAStore } from './types';

export const DEFAULT_BACKUP_CODE_COUNT = 10;
export const DEFAULT_MFA_ISSUER = 'AbsoluteAuth';
export const DEFAULT_MFA_SESSION_TTL_MS = MILLISECONDS_IN_A_DAY;
export const DEFAULT_SMS_CODE_LENGTH = 6;
const SMS_CODE_TTL_MINUTES = 5;
export const DEFAULT_SMS_CODE_TTL_MS =
	SMS_CODE_TTL_MINUTES * SECONDS_IN_A_MINUTE * MILLISECONDS_IN_A_SECOND;
export const DEFAULT_SMS_MAX_ATTEMPTS = 3;
export const DEFAULT_TOTP_MAX_ATTEMPTS = 5;

// Out-of-band SMS delivery payload. The plaintext `code` is handed to the consumer's sender
// (e.g. Twilio) exactly once and is never persisted or returned from any route.
export type SmsCodeMessage = {
	code: string;
	expiresAt: number;
	phone: string;
};

export type MfaConfig<UserType> = {
	mfaStore: MFAStore;
	// Stable per-user key for the store (e.g. the user's `sub`).
	getUserId: (user: UserType) => string;
	// Resolve the parked (unregistered) identity back into a user during a challenge.
	// For credentials this is `(identity) => getUserByEmail(identity.email)`.
	getChallengeUser: (
		userIdentity: Record<string, unknown>
	) => Promise<UserType | null | undefined> | UserType | null | undefined;
	backupCodeCount?: number;
	challengeRoute?: RouteString;
	// AES-GCM key (base64url) to encrypt the TOTP secret at rest. When omitted the
	// secret is stored as-is — set it in any real deployment.
	encryptionKey?: string;
	issuer?: string;
	managementRoute?: RouteString;
	onMfaChallengeError?: (context: {
		error: unknown;
		userId?: string;
	}) => void | Promise<void>;
	onMfaChallengeSuccess?: (context: {
		user: UserType;
		userSessionId: UserSessionId;
	}) => void | Promise<void>;
	onMfaEnrolled?: (context: { userId: string }) => void | Promise<void>;
	// Out-of-band SMS sender (e.g. Twilio). Required for the SMS factor to be usable — the
	// package never imports an SMS provider; the consumer owns delivery. The plaintext code
	// is passed here exactly once and must never be logged.
	onSendSmsCode?: (message: SmsCodeMessage) => void | Promise<void>;
	sessionDurationMs?: number;
	smsCodeLength?: number;
	smsCodeTtlMs?: number;
	smsMaxAttempts?: number;
	smsSetupRoute?: RouteString;
	smsVerifyRoute?: RouteString;
	// Max consecutive failed TOTP/backup-code verifications at the login challenge before
	// the second-factor step locks out. Independent of the first-factor (password) lockout.
	totpMaxAttempts?: number;
	totpSetupRoute?: RouteString;
	totpVerifyRoute?: RouteString;
};

export type MfaRouteProps<UserType> = MfaConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
	cookieSecure?: boolean;
};
