import { Elysia, t } from 'elysia';
import { generateSecureToken, hashPassword, hashToken } from '../crypto';
import { isStatusResponse } from '../typeGuards';
import {
	type CredentialsConfig,
	DEFAULT_VERIFICATION_TOKEN_TTL_MS
} from './config';
import { evaluatePassword } from './passwordPolicy';

export const credentialsRegister = <UserType>({
	credentialStore,
	onCreateCredentialUser,
	onRegistrationSuccess,
	onSendEmail,
	passwordPolicy,
	registerRoute = '/auth/register',
	verificationTokenDurationMs = DEFAULT_VERIFICATION_TOKEN_TTL_MS
}: CredentialsConfig<UserType>) =>
	new Elysia().post(
		registerRoute,
		async ({ body: { email, password }, status }) => {
			const normalizedEmail = email.trim().toLowerCase();
			if (!normalizedEmail.includes('@')) {
				return status('Bad Request', 'A valid email is required');
			}

			const policy = await evaluatePassword(password, passwordPolicy);
			if (!policy.ok) {
				return status('Bad Request', {
					message: 'Password does not meet the policy',
					violations: policy.violations
				});
			}

			const existing =
				await credentialStore.getCredentialByEmail(normalizedEmail);
			if (existing) {
				return status('Conflict', 'Email is already registered');
			}

			const created = await onCreateCredentialUser({
				email: normalizedEmail
			});
			if (created instanceof Response || isStatusResponse(created)) {
				return created;
			}

			const now = Date.now();
			await credentialStore.saveCredential({
				createdAt: now,
				email: normalizedEmail,
				emailVerified: false,
				passwordHash: await hashPassword(password),
				status: 'active',
				updatedAt: now
			});

			const token = generateSecureToken();
			const expiresAt = now + verificationTokenDurationMs;
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

			await onRegistrationSuccess?.({ email: normalizedEmail, user: created });

			return status('Created', { status: 'registered' });
		},
		{ body: t.Object({ email: t.String(), password: t.String() }) }
	);
