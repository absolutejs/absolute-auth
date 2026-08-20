import { Elysia, t } from 'elysia';
import { generateSecureToken, hashToken } from '../crypto';
import { isStatusResponse } from '../typeGuards';
import {
	type CredentialsConfig,
	DEFAULT_VERIFICATION_TOKEN_TTL_MS
} from './config';

export const credentialsEmailVerification = <UserType>({
	credentialStore,
	getUserByEmail,
	onCreateCredentialUser,
	onEmailVerified,
	onRegistrationSuccess,
	onSendEmail,
	requireEmailVerification = false,
	verificationTokenDurationMs = DEFAULT_VERIFICATION_TOKEN_TTL_MS,
	verifyEmailRoute = '/auth/verify-email'
}: CredentialsConfig<UserType>) =>
	new Elysia()
		.post(
			verifyEmailRoute,
			{ body: t.Object({ token: t.String() }) },
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
				// Defense in depth: do not rely on the store to reject expired
				// tokens (a custom CredentialStore might not), so an expired
				// verification token can never be accepted here.
				if (consumed.expiresAt < Date.now()) {
					return status(
						'Bad Request',
						'Invalid or expired verification token'
					);
				}

				const credential = await credentialStore.getCredentialByEmail(
					consumed.email
				);
				if (!credential) {
					return status(
						'Bad Request',
						'Invalid or expired verification token'
					);
				}

				let user = await getUserByEmail(consumed.email);
				if (
					requireEmailVerification &&
					!user &&
					credential.registrationData !== undefined
				) {
					const created = await onCreateCredentialUser({
						...credential.registrationData,
						email: consumed.email
					});
					if (
						created instanceof Response ||
						isStatusResponse(created)
					) {
						return created;
					}
					user = created;
				}

				// The account hook runs only after the token has been validated. If it
				// fails, the credential remains unverified and a new token can be
				// requested. If the credential update fails after account creation,
				// login remains blocked and the idempotent retry observes the user.
				await credentialStore.setEmailVerified(consumed.email);
				if (credential.registrationData !== undefined) {
					await credentialStore.saveCredential({
						...credential,
						emailVerified: true,
						registrationData: undefined,
						updatedAt: Date.now()
					});
				}
				if (user && credential.registrationData !== undefined) {
					await onRegistrationSuccess?.({
						email: consumed.email,
						user
					});
				}
				await onEmailVerified?.({ email: consumed.email });

				return status('OK', { status: 'email_verified' });
			}
		)
		.post(
			`${verifyEmailRoute}/request`,
			{ body: t.Object({ email: t.String() }) },
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
			}
		);
