import type { CredentialsConfig } from '../credentials/config';
import type { MfaConfig } from '../mfa/config';
import type {
	OnRevocationSuccess,
	OnSignOut
} from '../types';
import { isStatusResponse } from '../typeGuards';
import type { AuditEmitter } from './config';

// Each `compose*Audit` wraps the consumer's lifecycle hooks so a structured audit event
// is emitted whenever a flow completes — even when the consumer set no hook. `auth()`
// applies these when an `audit` block is configured.

export const composeCallbackAudit =
	<Context extends { authProvider: string }, Result>(
		onCallbackSuccess:
			| ((context: Context) => Promise<Result> | Result)
			| undefined,
		emit: AuditEmitter
	) =>
	async (context: Context) => {
		const result = await onCallbackSuccess?.(context);
		const failed =
			(result instanceof Response && result.status >= 400) ||
			(isStatusResponse(result) &&
				Number(Reflect.get(result, 'status')) >= 400);
		if (failed) return result;

		await emit({
			at: Date.now(),
			metadata: { authProvider: context.authProvider },
			type: 'oauth_login'
		});

		return result;
	};
export const composeCredentialsAudit = <UserType>(
	credentials: CredentialsConfig<UserType>,
	emit: AuditEmitter,
	getUserId?: (user: UserType) => string
): CredentialsConfig<UserType> => ({
	...credentials,
	onCredentialsLoginError: async (context) => {
		await emit({
			at: Date.now(),
			metadata: { email: context.email },
			type: 'credentials_login_failed'
		});

		return credentials.onCredentialsLoginError?.(context);
	},
	onCredentialsLoginSuccess: async (context) => {
		await emit({
			at: Date.now(),
			type: 'credentials_login',
			userId: getUserId?.(context.user)
		});

		return credentials.onCredentialsLoginSuccess?.(context);
	},
	onEmailVerified: async (context) => {
		await emit({
			at: Date.now(),
			metadata: { email: context.email },
			type: 'email_verified'
		});

		return credentials.onEmailVerified?.(context);
	},
	onPasswordReset: async (context) => {
		await emit({
			at: Date.now(),
			metadata: { email: context.email },
			type: 'password_reset'
		});

		return credentials.onPasswordReset?.(context);
	},
	onRegistrationSuccess: async (context) => {
		await emit({
			at: Date.now(),
			metadata: { email: context.email },
			type: 'register',
			userId: getUserId?.(context.user)
		});

		return credentials.onRegistrationSuccess?.(context);
	}
});
export const composeMfaAudit = <UserType>(
	mfa: MfaConfig<UserType>,
	emit: AuditEmitter
): MfaConfig<UserType> => ({
	...mfa,
	onMfaChallengeError: async (context) => {
		await emit({
			at: Date.now(),
			type: 'mfa_challenge_failed',
			userId: context.userId
		});

		return mfa.onMfaChallengeError?.(context);
	},
	onMfaChallengeSuccess: async (context) => {
		await emit({
			at: Date.now(),
			type: 'mfa_challenge',
			userId: mfa.getUserId(context.user)
		});

		return mfa.onMfaChallengeSuccess?.(context);
	},
	onMfaEnrolled: async (context) => {
		await emit({
			at: Date.now(),
			type: 'mfa_enrolled',
			userId: context.userId
		});

		return mfa.onMfaEnrolled?.(context);
	}
});
export const composeRevocationAudit =
	(onRevocationSuccess: OnRevocationSuccess, emit: AuditEmitter) =>
	async (context: Parameters<NonNullable<OnRevocationSuccess>>[0]) => {
		await emit({
			at: Date.now(),
			metadata: { authProvider: context.authProvider },
			type: 'token_revoked'
		});

		return onRevocationSuccess?.(context);
	};
export const composeSignOutAudit =
	<UserType>(onSignOut: OnSignOut<UserType>, emit: AuditEmitter) =>
	async (context: Parameters<NonNullable<OnSignOut<UserType>>>[0]) => {
		await emit({
			at: Date.now(),
			metadata: { authProvider: context.authProvider },
			type: 'logout'
		});

		return onSignOut?.(context);
	};
