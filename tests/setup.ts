import { createInMemoryAuthSessionStore } from '../src/session/inMemoryStore';
import type { SessionData, UserSessionId } from '../src/types';

export type TestUser = {
	email: string;
	sub: string;
};

const TEST_SESSION_TTL_MS = 60_000;

// A fixed, valid UUID v4 usable as a UserSessionId in tests.
export const TEST_SESSION_ID: UserSessionId =
	'123e4567-e89b-42d3-a456-426614174000';
export const createTestSessionData = (
	overrides: Partial<SessionData<TestUser>> = {}
): SessionData<TestUser> => ({
	accessToken: 'test-access-token',
	expiresAt: Date.now() + TEST_SESSION_TTL_MS,
	user: createTestUser(),
	...overrides
});
export const createTestSessionStore = () =>
	createInMemoryAuthSessionStore<TestUser>();
export const createTestUser = (overrides: Partial<TestUser> = {}) => ({
	email: 'user@example.com',
	sub: 'auth|test-user',
	...overrides
});
