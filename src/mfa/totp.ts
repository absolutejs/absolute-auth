import { Elysia, t } from 'elysia';
import {
	createTotpKeyUri,
	generateTotpSecret,
	verifyTotp,
	encryptSecret,
	decryptSecret,
	hashToken
} from '../crypto';
import { loadSessionFromSource } from '../session/access';
import { sessionStore } from '../session/state';
import { userSessionIdTypebox } from '../typebox';
import { generateBackupCodes } from './backupCodes';
import {
	DEFAULT_BACKUP_CODE_COUNT,
	DEFAULT_MFA_ISSUER,
	DEFAULT_MFA_MANAGEMENT_AUTH_MAX_AGE_MS,
	type MfaRouteProps
} from './config';
import { decryptTotpSecret, encryptTotpSecret } from './secret';
import { hasRecentAuthentication } from './recentAuth';
import {
	getMfaFactors,
	type TotpMfaFactor,
	type MFAStore,
	withMfaFactors
} from './types';

const FACTOR_LABEL_MAX_LENGTH = 80;
const DEFAULT_TOTP_LABEL = 'Authenticator app';

const RECEIPT_TTL_MS = 10 * 60 * 1000;
const MAX_ENROLLMENT_RETRIES = 5;

type EnrollmentInput = {
	userId: string;
	mfaStore: MFAStore;
	encryptionKey?: string;
};
const prepareEnrollment = async (
	input: EnrollmentInput & { label: string },
	retries = MAX_ENROLLMENT_RETRIES
): Promise<TotpMfaFactor | undefined> => {
	const existing = await input.mfaStore.getEnrollment(input.userId);
	const pending =
		existing &&
		getMfaFactors(existing).find(
			(factor): factor is TotpMfaFactor =>
				factor.type === 'totp' && !factor.verified
		);
	if (pending) return pending;
	if (retries === 0) return undefined;
	const now = Date.now();
	const base = existing ?? {
		backupCodeHashes: [],
		createdAt: now,
		smsVerified: false,
		totpVerified: false,
		updatedAt: now,
		userId: input.userId
	};
	const factor: TotpMfaFactor = {
		id: crypto.randomUUID(),
		label: input.label,
		secretCiphertext: await encryptTotpSecret(
			generateTotpSecret(),
			input.encryptionKey
		),
		type: 'totp',
		verified: false
	};
	const saved = await input.mfaStore.saveTotpEnrollment({
		enrollment: withMfaFactors({ ...base, updatedAt: now }, [
			...getMfaFactors(base),
			factor
		]),
		expected: existing
	});

	return saved ? factor : prepareEnrollment(input, retries - 1);
};

const readRecoveryReceipt = async (
	factor: TotpMfaFactor,
	hashes: string[],
	key: string
) => {
	if (
		!factor.recoveryReceipt ||
		!factor.recoveryReceiptExpiresAt ||
		Date.now() > factor.recoveryReceiptExpiresAt
	)
		return [];
	const codes: string[] = JSON.parse(
		await decryptSecret(factor.recoveryReceipt, key)
	);
	const checks = await Promise.all(
		codes.map(async (code) => hashes.includes(await hashToken(code)))
	);

	return codes.filter((_, index) => checks[index]);
};

type VerifyResult =
	| { backupCodes: string[]; newlyEnrolled: boolean }
	| { error: string };
const confirmEnrollment = async (
	input: EnrollmentInput & {
		factorId?: string;
		code: string;
		backupCodeCount: number;
	},
	retries = MAX_ENROLLMENT_RETRIES
): Promise<VerifyResult> => {
	const enrollment = await input.mfaStore.getEnrollment(input.userId);
	if (!enrollment) return { error: 'No TOTP enrollment in progress' };
	const factors = getMfaFactors(enrollment);
	const factor = factors.find(
		(candidate): candidate is TotpMfaFactor =>
			candidate.type === 'totp' &&
			(candidate.id === input.factorId ||
				(input.factorId === undefined && !candidate.verified))
	);
	if (!factor) return { error: 'No TOTP enrollment in progress' };
	const secret = await decryptTotpSecret(
		factor.secretCiphertext,
		input.encryptionKey
	);
	if (!(await verifyTotp({ secret, token: input.code.trim() })))
		return { error: 'Invalid TOTP code' };
	// Derive a domain-separated receipt key from the TOTP secret so rotation of
	// its at-rest encryption key does not invalidate in-flight enrollment retries.
	const receiptKey = await hashToken(`mfa-enrollment-receipt:${secret}`);
	if (factor.verified)
		return {
			backupCodes: await readRecoveryReceipt(
				factor,
				enrollment.backupCodeHashes,
				receiptKey
			),
			newlyEnrolled: false
		};
	if (retries === 0)
		return { error: 'Enrollment changed. Please try again.' };
	const { codes, hashes } =
		enrollment.backupCodeHashes.length === 0
			? await generateBackupCodes(input.backupCodeCount)
			: { codes: [], hashes: enrollment.backupCodeHashes };
	const verified: TotpMfaFactor = {
		...factor,
		verified: true,
		...(codes.length
			? {
					recoveryReceipt: await encryptSecret(
						JSON.stringify(codes),
						receiptKey
					),
					recoveryReceiptExpiresAt: Date.now() + RECEIPT_TTL_MS
				}
			: {})
	};
	const saved = await input.mfaStore.saveTotpEnrollment({
		enrollment: withMfaFactors(
			{ ...enrollment, backupCodeHashes: hashes, updatedAt: Date.now() },
			factors.map((candidate) =>
				candidate.id === factor.id ? verified : candidate
			)
		),
		expected: enrollment
	});

	return saved
		? { backupCodes: codes, newlyEnrolled: true }
		: confirmEnrollment(input, retries - 1);
};

export const mfaTotpRoutes = <UserType>({
	authSessionStore,
	backupCodeCount = DEFAULT_BACKUP_CODE_COUNT,
	encryptionKey,
	getUserId,
	issuer = DEFAULT_MFA_ISSUER,
	managementAuthMaxAgeMs = DEFAULT_MFA_MANAGEMENT_AUTH_MAX_AGE_MS,
	mfaStore,
	onMfaEnrolled,
	totpSetupRoute = '/auth/mfa/totp/setup',
	totpVerifyRoute = '/auth/mfa/totp/verify'
}: MfaRouteProps<UserType>) =>
	new Elysia()
		.use(sessionStore<UserType>())
		.post(
			totpSetupRoute,
			{
				body: t.Object({
					label: t.Optional(
						t.String({ maxLength: FACTOR_LABEL_MAX_LENGTH })
					)
				}),
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
			},
			async ({
				body: { label },
				cookie: { user_session_id },
				status,
				store: { session }
			}) => {
				const userSession = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});
				if (!userSession) {
					return status('Unauthorized', 'Authentication required');
				}
				if (
					!hasRecentAuthentication(
						userSession,
						managementAuthMaxAgeMs
					)
				) {
					return status(
						'Unauthorized',
						'Recent authentication required'
					);
				}

				const userId = getUserId(userSession.user);
				const factor = await prepareEnrollment({
					encryptionKey,
					label: label?.trim() || DEFAULT_TOTP_LABEL,
					mfaStore,
					userId
				});
				if (!factor)
					return status(
						'Conflict',
						'Enrollment changed. Please try again.'
					);
				const secret = await decryptTotpSecret(
					factor.secretCiphertext,
					encryptionKey
				);

				return status('OK', {
					factorId: factor.id,
					label: factor.label,
					secret,
					uri: createTotpKeyUri({
						accountName: factor.label,
						issuer,
						secret
					})
				});
			}
		)
		.post(
			totpVerifyRoute,
			{
				body: t.Object({
					code: t.String(),
					factorId: t.Optional(t.String())
				}),
				cookie: t.Cookie({ user_session_id: userSessionIdTypebox })
			},
			async ({
				body: { code, factorId },
				cookie: { user_session_id },
				status,
				store: { session }
			}) => {
				const userSession = await loadSessionFromSource({
					authSessionStore,
					session,
					userSessionId: user_session_id.value
				});
				if (!userSession) {
					return status('Unauthorized', 'Authentication required');
				}
				if (
					!hasRecentAuthentication(
						userSession,
						managementAuthMaxAgeMs
					)
				) {
					return status(
						'Unauthorized',
						'Recent authentication required'
					);
				}

				const userId = getUserId(userSession.user);
				const result = await confirmEnrollment({
					backupCodeCount,
					code,
					encryptionKey,
					factorId,
					mfaStore,
					userId
				});
				if ('error' in result)
					return status('Bad Request', result.error);
				if (result.newlyEnrolled) await onMfaEnrolled?.({ userId });

				return status('OK', { backupCodes: result.backupCodes });
			}
		);
