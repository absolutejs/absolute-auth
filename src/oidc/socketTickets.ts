import { generateSecureToken, hashToken } from '../crypto';
import type { AuthPrincipal } from '../principal';
import type { SocketTicketStore } from './types';

const DEFAULT_SOCKET_TICKET_TTL_MS = 30_000;
const TICKET_BYTES = 32;

export const consumeSocketTicket = async <UserType>({
	audience,
	getUser,
	now = Date.now(),
	store,
	ticket
}: {
	audience: string;
	getUser: (subject: string) => Promise<UserType | null> | UserType | null;
	now?: number;
	store: SocketTicketStore;
	ticket: string;
}): Promise<AuthPrincipal<UserType> | undefined> => {
	const record = await store.consumeTicket(await hashToken(ticket), now);
	if (!record || record.audience !== audience) return undefined;
	const user = await getUser(record.subject);
	if (user === null) return undefined;

	return {
		audience: record.audience,
		clientId: record.clientId,
		kind: 'access-token',
		scopes: [...record.scopes],
		subject: record.subject,
		user
	};
};
export const issueSocketTicket = async ({
	audience,
	clientId,
	now = Date.now(),
	scopes,
	store,
	subject,
	ttlMs = DEFAULT_SOCKET_TICKET_TTL_MS
}: {
	audience: string;
	clientId: string;
	now?: number;
	scopes: string[];
	store: SocketTicketStore;
	subject: string;
	ttlMs?: number;
}) => {
	if (!Number.isFinite(ttlMs) || ttlMs <= 0)
		throw new Error('socketTicketTtlMs must be positive');
	const ticket = `ast_${generateSecureToken(TICKET_BYTES)}`;
	await store.saveTicket({
		audience,
		clientId,
		expiresAt: now + ttlMs,
		scopes: [...scopes],
		subject,
		ticketHash: await hashToken(ticket)
	});

	return { expiresInMs: ttlMs, ticket };
};
