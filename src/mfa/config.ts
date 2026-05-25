import { MILLISECONDS_IN_A_DAY } from '../constants';
import type { AuthSessionStore } from '../session/types';
import type { RouteString, UserSessionId } from '../types';
import type { MFAStore } from './types';

export const DEFAULT_BACKUP_CODE_COUNT = 10;
export const DEFAULT_MFA_ISSUER = 'AbsoluteAuth';
export const DEFAULT_MFA_SESSION_TTL_MS = MILLISECONDS_IN_A_DAY;

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
	onMfaChallengeError?: (context: {
		error: unknown;
		userId?: string;
	}) => void | Promise<void>;
	onMfaChallengeSuccess?: (context: {
		user: UserType;
		userSessionId: UserSessionId;
	}) => void | Promise<void>;
	onMfaEnrolled?: (context: { userId: string }) => void | Promise<void>;
	sessionDurationMs?: number;
	totpSetupRoute?: RouteString;
	totpVerifyRoute?: RouteString;
};

export type MfaRouteProps<UserType> = MfaConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
};
