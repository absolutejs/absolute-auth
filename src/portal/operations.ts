import { generateSecureToken, hashToken } from '../crypto';
import {
	DEFAULT_SETUP_SESSION_TTL_MS,
	type SetupSessionRequest
} from './config';
import type { SetupSession, SetupSessionStore } from './types';

const BEARER_PREFIX = 'Bearer ';

// Mint a scoped, time-boxed admin-portal setup link. The vendor calls this from its own
// (RBAC-protected) admin surface and sends the customer's IT admin a link embedding `token`.
// The plaintext token is returned once; only its hash is persisted.
export const createSetupSession = async ({
	capabilities,
	createdBy,
	organizationId,
	setupSessionDurationMs = DEFAULT_SETUP_SESSION_TTL_MS,
	setupSessionStore
}: SetupSessionRequest) => {
	const token = generateSecureToken();
	const now = Date.now();
	const setupSession: SetupSession = {
		capabilities,
		createdAt: now,
		createdBy,
		expiresAt: now + setupSessionDurationMs,
		organizationId,
		setupSessionId: crypto.randomUUID(),
		tokenHash: await hashToken(token)
	};
	await setupSessionStore.saveSetupSession(setupSession);

	return { setupSession, token };
};

// Resolve a portal request's `Authorization: Bearer <setup-token>` to a live setup session, or
// undefined when the header is missing/malformed, the token is unknown, or the session expired.
export const resolveSetupSession = async ({
	authorization,
	setupSessionStore
}: {
	authorization: string | undefined;
	setupSessionStore: SetupSessionStore;
}) => {
	if (
		authorization === undefined ||
		!authorization.startsWith(BEARER_PREFIX)
	) {
		return undefined;
	}

	const token = authorization.slice(BEARER_PREFIX.length).trim();
	if (token.length === 0) return undefined;

	const session = await setupSessionStore.getSetupSessionByTokenHash(
		await hashToken(token)
	);
	if (!session || session.expiresAt < Date.now()) return undefined;

	return session;
};
