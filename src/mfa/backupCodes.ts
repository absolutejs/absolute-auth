import { generateSecureToken, hashToken } from '../crypto';

const BACKUP_CODE_BYTES = 8;

// Generates single-use recovery codes: the plaintext codes are returned to the user
// exactly once, only their hashes are persisted.
export const consumeBackupCode = async (code: string, hashes: string[]) => {
	const codeHash = await hashToken(code);
	const index = hashes.indexOf(codeHash);
	if (index < 0) return undefined;

	return hashes.filter((_, position) => position !== index);
};
export const generateBackupCodes = async (count: number) => {
	const codes = Array.from({ length: count }, () =>
		generateSecureToken(BACKUP_CODE_BYTES)
	);
	const hashes = await Promise.all(codes.map((code) => hashToken(code)));

	return { codes, hashes };
};
