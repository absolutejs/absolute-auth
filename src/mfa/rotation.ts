import { decryptTotpSecret, encryptTotpSecret } from './secret';
import type { MfaEnrollment, MFAStore } from './types';

export type MfaKeyRotationResult = {
	alreadyRotated: number;
	rotated: number;
	skippedNoSecret: number;
	total: number;
};

type EnrollmentPlan =
	| { enrollment: MfaEnrollment; kind: 'rotate' }
	| { kind: 'already' }
	| { kind: 'skip' };

// Decrypt with `key`, or undefined if it doesn't apply (wrong key → AES-GCM
// throws). Kept separate so callers stay flat (no nested try).
const tryDecrypt = async (ciphertext: string, key: string) => {
	try {
		return await decryptTotpSecret(ciphertext, key);
	} catch {
		return undefined;
	}
};

// Throws when a ciphertext that didn't decrypt with the old key doesn't decrypt
// with the new one either — it predates both keys, a real problem to surface
// rather than silently skip.
const ensureReadable = async (
	ciphertext: string,
	key: string,
	userId: string
) => {
	if ((await tryDecrypt(ciphertext, key)) === undefined) {
		throw new Error(
			`TOTP secret for ${userId} decrypts with neither the old nor the new key`
		);
	}
};

// Decide what one enrollment needs: skip (no secret), already (readable with the
// new key), or rotate (re-encrypt with the new key).
const planEnrollment = async (
	enrollment: MfaEnrollment,
	oldKey: string,
	newKey: string
) => {
	const ciphertext = enrollment.totpSecretCiphertext;
	if (ciphertext === undefined || ciphertext.length === 0) {
		const plan: EnrollmentPlan = { kind: 'skip' };

		return plan;
	}
	const secret = await tryDecrypt(ciphertext, oldKey);
	if (secret === undefined) {
		await ensureReadable(ciphertext, newKey, enrollment.userId);
		const plan: EnrollmentPlan = { kind: 'already' };

		return plan;
	}
	const plan: EnrollmentPlan = {
		enrollment: {
			...enrollment,
			totpSecretCiphertext: await encryptTotpSecret(secret, newKey),
			updatedAt: Date.now()
		},
		kind: 'rotate'
	};

	return plan;
};

// Re-encrypt every stored TOTP secret from `oldKey` to `newKey` — for scheduled
// key rotation or an emergency rotation after a suspected key leak. Backup codes
// are hashed (not encrypted), so they're untouched. Idempotent: a secret already
// readable with `newKey` is left as-is, so a re-run after a partial failure
// resumes safely. The package ships no CLI — call this from your own script/cron
// (it relies on `MFAStore.listEnrollments`). After it returns, switch your
// configured encryption key to `newKey`.
export const rotateMfaEncryptionKey = async ({
	mfaStore,
	newKey,
	oldKey
}: {
	mfaStore: MFAStore;
	newKey: string;
	oldKey: string;
}) => {
	const enrollments = await mfaStore.listEnrollments();
	const plans = await Promise.all(
		enrollments.map((enrollment) =>
			planEnrollment(enrollment, oldKey, newKey)
		)
	);
	await Promise.all(
		plans.map((plan) =>
			plan.kind === 'rotate'
				? mfaStore.saveEnrollment(plan.enrollment)
				: Promise.resolve()
		)
	);

	return {
		alreadyRotated: plans.filter((plan) => plan.kind === 'already').length,
		rotated: plans.filter((plan) => plan.kind === 'rotate').length,
		skippedNoSecret: plans.filter((plan) => plan.kind === 'skip').length,
		total: plans.length
	};
};
