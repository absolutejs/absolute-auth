import { type Cookie, Elysia, t } from 'elysia';
import { generateSecureToken, hashToken } from '../crypto';
import { promoteToSession } from '../session/promote';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import type { SessionRecord, UserSessionId } from '../types';
import {
	DEFAULT_MAGIC_LINK_TTL_MS,
	DEFAULT_OTP_LENGTH,
	DEFAULT_OTP_TTL_MS,
	DEFAULT_PASSWORDLESS_ROUTE,
	DEFAULT_PASSWORDLESS_SESSION_TTL_MS,
	type PasswordlessRouteProps
} from './config';

const DECIMAL_DIGITS = 10;

// Numeric OTP. The slight modulo bias over 0-255 is negligible for a short-lived one-time code.
const generateOtpCode = (length: number) => {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);

	return Array.from(bytes, (byte) => (byte % DECIMAL_DIGITS).toString()).join(
		''
	);
};

// Passwordless login: magic links and email/SMS OTP, each mounted only when its send hook is
// configured (the token is delivered out-of-band — never returned from the unauthenticated request
// route). Both verify routes resolve the email to a user and mint the standard session. `auth()`
// mounts this before `protectRoutePlugin` when a `passwordless` block is supplied.
export const passwordlessRoutes = <UserType>({
	authSessionStore,
	emit,
	getUserByEmail,
	getUserId,
	magicLinkTokenDurationMs = DEFAULT_MAGIC_LINK_TTL_MS,
	onCreateUser,
	onPasswordlessLogin,
	onSendMagicLink,
	onSendOtp,
	otpDurationMs = DEFAULT_OTP_TTL_MS,
	otpLength = DEFAULT_OTP_LENGTH,
	passwordlessRoute = DEFAULT_PASSWORDLESS_ROUTE,
	passwordlessTokenStore,
	sessionDurationMs = DEFAULT_PASSWORDLESS_SESSION_TTL_MS
}: PasswordlessRouteProps<UserType>) => {
	const cookie = t.Cookie({
		user_session_id: t.Optional(userSessionIdTypebox)
	});

	// Resolve the email to a user (creating one when `onCreateUser` is set), mint a session, and
	// fire the audit event + login hook. Returns the new session id, or undefined to reject.
	const completeLogin = async (
		email: string,
		userSessionCookie: Cookie<UserSessionId | undefined>,
		session: SessionRecord<UserType>
	) => {
		const existing = await getUserByEmail(email);
		const user =
			existing ?? (onCreateUser ? await onCreateUser({ email }) : null);
		if (!user) return undefined;

		const userSessionId = await promoteToSession({
			authSessionStore,
			cookie: userSessionCookie,
			inMemorySession: session,
			sessionDurationMs,
			user
		});
		await emit?.({
			at: Date.now(),
			metadata: { email },
			type: 'passwordless_login',
			userId: getUserId?.(user)
		});
		await onPasswordlessLogin?.({ user, userSessionId });

		return userSessionId;
	};

	const magicLink = onSendMagicLink
		? new Elysia()
				.use(sessionStore<UserType>())
				.post(
					`${passwordlessRoute}/magic-link`,
					async ({ body: { email }, status }) => {
						const normalizedEmail = email.trim().toLowerCase();
						const token = generateSecureToken();
						const expiresAt = Date.now() + magicLinkTokenDurationMs;
						await passwordlessTokenStore.saveToken({
							email: normalizedEmail,
							expiresAt,
							tokenHash: await hashToken(token)
						});
						await onSendMagicLink({
							email: normalizedEmail,
							expiresAt,
							token
						});

						return status('OK', { status: 'magic_link_sent' });
					},
					{ body: t.Object({ email: t.String() }) }
				)
				.post(
					`${passwordlessRoute}/magic-link/verify`,
					async ({
						body: { token },
						cookie: { user_session_id },
						status,
						store: { session }
					}) => {
						const consumed =
							await passwordlessTokenStore.consumeToken(
								await hashToken(token)
							);
						if (!consumed || consumed.expiresAt < Date.now()) {
							return status(
								'Bad Request',
								'Invalid or expired link'
							);
						}

						const userSessionId = await completeLogin(
							consumed.email,
							user_session_id,
							session
						);
						if (!userSessionId) {
							return status(
								'Unauthorized',
								'No account for this email'
							);
						}

						return status('OK', { status: 'authenticated' });
					},
					{ body: t.Object({ token: t.String() }), cookie }
				)
		: new Elysia();

	const otp = onSendOtp
		? new Elysia()
				.use(sessionStore<UserType>())
				.post(
					`${passwordlessRoute}/otp`,
					async ({ body: { email }, status }) => {
						const normalizedEmail = email.trim().toLowerCase();
						const code = generateOtpCode(otpLength);
						const expiresAt = Date.now() + otpDurationMs;
						await passwordlessTokenStore.saveToken({
							email: normalizedEmail,
							expiresAt,
							tokenHash: await hashToken(
								`${normalizedEmail}:${code}`
							)
						});
						await onSendOtp({
							code,
							email: normalizedEmail,
							expiresAt
						});

						return status('OK', { status: 'otp_sent' });
					},
					{ body: t.Object({ email: t.String() }) }
				)
				.post(
					`${passwordlessRoute}/otp/verify`,
					async ({
						body: { code, email },
						cookie: { user_session_id },
						status,
						store: { session }
					}) => {
						const normalizedEmail = email.trim().toLowerCase();
						const consumed =
							await passwordlessTokenStore.consumeToken(
								await hashToken(`${normalizedEmail}:${code}`)
							);
						if (!consumed || consumed.expiresAt < Date.now()) {
							return status(
								'Bad Request',
								'Invalid or expired code'
							);
						}

						const userSessionId = await completeLogin(
							consumed.email,
							user_session_id,
							session
						);
						if (!userSessionId) {
							return status(
								'Unauthorized',
								'No account for this email'
							);
						}

						return status('OK', { status: 'authenticated' });
					},
					{
						body: t.Object({
							code: t.String(),
							email: t.String()
						}),
						cookie
					}
				)
		: new Elysia();

	return new Elysia().use(magicLink).use(otp);
};
