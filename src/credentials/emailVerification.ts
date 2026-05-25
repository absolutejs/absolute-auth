import { Elysia, t } from 'elysia';
import { generateSecureToken, hashToken } from '../crypto';
import {
	type CredentialsConfig,
	DEFAULT_VERIFICATION_TOKEN_TTL_MS
} from './config';

export const credentialsEmailVerification = <UserType>({
	credentialStore,
	onEmailVerified,
	onSendEmail,
	verificationTokenDurationMs = DEFAULT_VERIFICATION_TOKEN_TTL_MS,
	verifyEmailRoute = '/auth/verify-email'
}: CredentialsConfig<UserType>) =>
	new Elysia()
		.post(
			verifyEmailRoute,
			async ({ body: { token }, status }) => {
				const consumed = await credentialStore.consumeVerificationToken(
					await hashToken(token)
				);
				if (!consumed) {
					return status(
						'Bad Request',
						'Invalid or expired verification token'
					);
				}

				await credentialStore.setEmailVerified(consumed.email);
				await onEmailVerified?.({ email: consumed.email });

				return status('OK', { status: 'email_verified' });
			},
			{ body: t.Object({ token: t.String() }) }
		)
		.post(
			`${verifyEmailRoute}/request`,
			async ({ body: { email }, status }) => {
				const normalizedEmail = email.trim().toLowerCase();
				const credential =
					await credentialStore.getCredentialByEmail(normalizedEmail);

				// Always 200 regardless of existence to avoid account enumeration.
				if (credential && !credential.emailVerified) {
					const token = generateSecureToken();
					const expiresAt = Date.now() + verificationTokenDurationMs;
					await credentialStore.saveVerificationToken({
						email: normalizedEmail,
						expiresAt,
						tokenHash: await hashToken(token)
					});
					await onSendEmail({
						email: normalizedEmail,
						expiresAt,
						token,
						type: 'verify_email'
					});
				}

				return status('OK', { status: 'verification_requested' });
			},
			{ body: t.Object({ email: t.String() }) }
		);
