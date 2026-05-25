import { Elysia, t } from 'elysia';
import { generateSecureToken, hashPassword, hashToken } from '../crypto';
import { type CredentialsConfig, DEFAULT_RESET_TOKEN_TTL_MS } from './config';
import { evaluatePassword } from './passwordPolicy';

export const credentialsPasswordReset = <UserType>({
	credentialStore,
	onPasswordReset,
	onSendEmail,
	passwordPolicy,
	resetPasswordRoute = '/auth/reset-password',
	resetTokenDurationMs = DEFAULT_RESET_TOKEN_TTL_MS
}: CredentialsConfig<UserType>) =>
	new Elysia()
		.post(
			`${resetPasswordRoute}/request`,
			async ({ body: { email }, status }) => {
				const normalizedEmail = email.trim().toLowerCase();
				const credential =
					await credentialStore.getCredentialByEmail(normalizedEmail);

				// Always 200 regardless of existence to avoid account enumeration.
				if (credential && credential.status === 'active') {
					const token = generateSecureToken();
					const expiresAt = Date.now() + resetTokenDurationMs;
					await credentialStore.saveResetToken({
						email: normalizedEmail,
						expiresAt,
						tokenHash: await hashToken(token)
					});
					await onSendEmail({
						email: normalizedEmail,
						expiresAt,
						token,
						type: 'reset_password'
					});
				}

				return status('OK', { status: 'reset_requested' });
			},
			{ body: t.Object({ email: t.String() }) }
		)
		.post(
			resetPasswordRoute,
			async ({ body: { password, token }, status }) => {
				const consumed = await credentialStore.consumeResetToken(
					await hashToken(token)
				);
				if (!consumed) {
					return status(
						'Bad Request',
						'Invalid or expired reset token'
					);
				}

				const policy = await evaluatePassword(password, passwordPolicy);
				if (!policy.ok) {
					return status('Bad Request', {
						message: 'Password does not meet the policy',
						violations: policy.violations
					});
				}

				const existing = await credentialStore.getCredentialByEmail(
					consumed.email
				);
				const now = Date.now();
				await credentialStore.saveCredential({
					createdAt: existing?.createdAt ?? now,
					email: consumed.email,
					// Completing a reset proves control of the inbox.
					emailVerified: true,
					organizationId: existing?.organizationId,
					passwordHash: await hashPassword(password),
					status: existing?.status ?? 'active',
					updatedAt: now,
					userId: existing?.userId
				});
				// Consumers should revoke the user's other sessions here — call the
				// exported `revokeUserSessions({ authSessionStore, getUserId, userId })`
				// from this hook (it scans the session store by user).
				await onPasswordReset?.({ email: consumed.email });

				return status('OK', { status: 'password_reset' });
			},
			{
				body: t.Object({ password: t.String(), token: t.String() })
			}
		);
