import { and, eq, gt, isNull } from 'drizzle-orm';
import { bigint, pgTable, text } from 'drizzle-orm/pg-core';
import type { AnyPgDatabase } from '../stores/postgres';
export type WebAuthnChallenge = {
	id: string;
	challenge: string;
	purpose: 'registration' | 'authentication' | 'approval';
	expiresAt: number;
	userId?: string;
	sessionId?: string;
};
export type WebAuthnChallengeStore = {
	save: (challenge: WebAuthnChallenge) => Promise<void>;
	consume: (
		input: Pick<
			WebAuthnChallenge,
			'id' | 'purpose' | 'userId' | 'sessionId'
		> & { now: number }
	) => Promise<WebAuthnChallenge | undefined>;
};
export const webauthnChallengesTable = pgTable('auth_webauthn_challenges', {
	challenge: text().notNull(),
	expires_at: bigint({ mode: 'number' }).notNull(),
	id: text().primaryKey(),
	purpose: text().$type<WebAuthnChallenge['purpose']>().notNull(),
	session_id: text(),
	user_id: text()
});
export const createInMemoryWebAuthnChallengeStore =
	(): WebAuthnChallengeStore => {
		const entries = new Map<string, WebAuthnChallenge>();

		return {
			consume: async (input) => {
				for (const [id, entry] of entries)
					if (entry.expiresAt <= input.now) entries.delete(id);
				const entry = entries.get(input.id);
				if (
					!entry ||
					entry.purpose !== input.purpose ||
					entry.userId !== input.userId ||
					entry.sessionId !== input.sessionId
				)
					return undefined;
				entries.delete(input.id);

				return { ...entry };
			},
			save: async (challenge) => {
				if (entries.has(challenge.id))
					throw new Error('Challenge already exists');
				entries.set(challenge.id, { ...challenge });
			}
		};
	};
export const createPostgresWebAuthnChallengeStore = <DB extends AnyPgDatabase>(
	db: DB
): WebAuthnChallengeStore => ({
	consume: async (input) => {
		const [entry] = await db
			.delete(webauthnChallengesTable)
			.where(
				and(
					eq(webauthnChallengesTable.id, input.id),
					eq(webauthnChallengesTable.purpose, input.purpose),
					gt(webauthnChallengesTable.expires_at, input.now),
					input.userId === undefined
						? isNull(webauthnChallengesTable.user_id)
						: eq(webauthnChallengesTable.user_id, input.userId),
					input.sessionId === undefined
						? isNull(webauthnChallengesTable.session_id)
						: eq(
								webauthnChallengesTable.session_id,
								input.sessionId
							)
				)
			)
			.returning();

		return entry
			? {
					challenge: entry.challenge,
					expiresAt: entry.expires_at,
					id: entry.id,
					purpose: entry.purpose,
					sessionId: entry.session_id ?? undefined,
					userId: entry.user_id ?? undefined
				}
			: undefined;
	},
	save: async (entry) => {
		await db.insert(webauthnChallengesTable).values({
			challenge: entry.challenge,
			expires_at: entry.expiresAt,
			id: entry.id,
			purpose: entry.purpose,
			session_id: entry.sessionId ?? null,
			user_id: entry.userId ?? null
		});
	}
});
