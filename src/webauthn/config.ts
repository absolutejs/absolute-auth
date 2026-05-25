import type { AuditEmitter } from '../audit/config';
import { MILLISECONDS_IN_A_DAY } from '../constants';
import type { AuthSessionStore } from '../session/types';
import type { RouteString, UserSessionId } from '../types';
import type { WebAuthnAdapter } from './adapter';
import type { WebAuthnCredentialStore } from './types';

const FIVE_MINUTES_MS = 300_000;

export const DEFAULT_WEBAUTHN_CHALLENGE_TTL_MS = FIVE_MINUTES_MS;
export const DEFAULT_WEBAUTHN_ROUTE: RouteString = '/auth/webauthn';
export const DEFAULT_WEBAUTHN_SESSION_TTL_MS = MILLISECONDS_IN_A_DAY;
export const WEBAUTHN_CHALLENGE_COOKIE = 'webauthn_challenge';

// Passwordless / passkey auth (WebAuthn). Additive and optional, mirroring the other auth blocks.
// `auth()` mounts the registration ceremony (add a passkey to the authenticated user) and the
// authentication ceremony (passwordless sign-in → mints the same `SessionData<UserType>`) only
// when this block is supplied. SAML-style: a `webauthnAdapter` wraps a vetted library.
export type WebAuthnConfig<UserType> = {
	credentialStore: WebAuthnCredentialStore;
	// Stable per-user key (e.g. the user's `sub`) — groups a user's passkeys and labels them.
	getUserId: (user: UserType) => string;
	// Resolve a credential's stored `userId` back into a user during passwordless authentication.
	getWebAuthnUser: (
		userId: string
	) => Promise<UserType | null | undefined> | UserType | null | undefined;
	// The expected ceremony origin, e.g. 'https://example.com'.
	origin: string;
	// The Relying Party ID — the registrable domain the passkey is scoped to, e.g. 'example.com'.
	rpId: string;
	// Human-facing Relying Party name shown by the authenticator.
	rpName: string;
	webauthnAdapter: WebAuthnAdapter;
	challengeDurationMs?: number;
	// Display handles shown in the authenticator UI during registration (default to the user id).
	getUserDisplayName?: (user: UserType) => string;
	getUserName?: (user: UserType) => string;
	onWebAuthnAuthenticated?: (context: {
		user: UserType;
		userSessionId: UserSessionId;
	}) => void | Promise<void>;
	onWebAuthnRegistered?: (context: {
		credentialId: string;
		userId: string;
	}) => void | Promise<void>;
	sessionDurationMs?: number;
	webauthnRoute?: RouteString;
};

export type WebAuthnRouteProps<UserType> = WebAuthnConfig<UserType> & {
	authSessionStore?: AuthSessionStore<UserType>;
	// When `auth()` has an audit block, registration / authentication emit audit events.
	emit?: AuditEmitter;
};
