import { and, eq, inArray } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '../crypto';
import type { AnyPgDatabase } from '../stores/postgres';
import { credentialsTable } from './postgresCredentialStore';
import { evaluatePassword, type PasswordPolicy } from './passwordPolicy';
import type { CredentialStore } from './types';

/** Insert-only: a concurrent registration must never replace another account's credential. */
export const insertAccountCredential = async <DB extends AnyPgDatabase>(
	db: DB,
	input: {
		email: string;
		userId: string;
		passwordHash: string;
		emailVerified?: boolean;
	}
) => {
	const now = Date.now();
	await db.insert(credentialsTable).values({
		created_at_ms: now,
		email: input.email.trim().toLowerCase(),
		email_verified: input.emailVerified ?? false,
		password_hash: input.passwordHash,
		status: 'active',
		updated_at_ms: now,
		user_id: input.userId
	});
};
const passwordMatches = async (password: string, hash: string) => {
	try {
		return await verifyPassword(password, hash);
	} catch {
		return false;
	}
};

/** Prepare outside the account transaction; insert inside it to preserve atomic signup. */
export const prepareAccountPassword = async (
	password: string,
	policy?: PasswordPolicy
) => {
	const result = await evaluatePassword(password, policy);
	if (!result.ok) throw new Error('Password does not meet the policy');

	return hashPassword(password);
};

let dummyHash: Promise<string> | undefined;
/** Resolve by the credential's canonical user ID, never the profile/contact email. */
export const authenticateAccountPassword = async <UserType>({
	credentialStore,
	getUser,
	email,
	password
}: {
	credentialStore: CredentialStore;
	getUser: (userId: string) => Promise<UserType | null | undefined>;
	email: string;
	password: string;
}) => {
	const credential = await credentialStore.getCredentialByEmail(
		email.trim().toLowerCase()
	);
	const hash =
		credential?.passwordHash ??
		(await (dummyHash ??= hashPassword('absolute-auth-account-timing')));
	let valid = false;
	try {
		valid = await verifyPassword(password, hash);
	} catch {
		/* Malformed imported hashes fail closed. */
	}
	if (!valid || credential?.status !== 'active' || !credential.userId)
		return null;

	return (await getUser(credential.userId)) ?? null;
};

/** Caller supplies a transaction, keeping all matching password changes atomic. */
export const changeAccountPassword = async <DB extends AnyPgDatabase>(
	db: DB,
	input: {
		userId: string;
		currentPassword: string;
		newPassword: string;
		passwordPolicy?: PasswordPolicy;
	}
) => {
	const rows = await db
		.select()
		.from(credentialsTable)
		.where(
			and(
				eq(credentialsTable.user_id, input.userId),
				eq(credentialsTable.status, 'active')
			)
		)
		.for('update');
	if (!rows.length) return 'no_password' as const;
	const verified = await rows.reduce<Promise<typeof rows>>(
		async (previous, row) => {
			const matches = await previous;
			if (await passwordMatches(input.currentPassword, row.password_hash))
				matches.push(row);

			return matches;
		},
		Promise.resolve([])
	);
	if (!verified.length) return 'invalid_password' as const;
	const passwordHash = await prepareAccountPassword(
		input.newPassword,
		input.passwordPolicy
	);
	await db
		.update(credentialsTable)
		.set({ password_hash: passwordHash, updated_at_ms: Date.now() })
		.where(
			and(
				inArray(
					credentialsTable.email,
					verified.map((row) => row.email)
				),
				eq(credentialsTable.user_id, input.userId)
			)
		);

	return 'changed' as const;
};
