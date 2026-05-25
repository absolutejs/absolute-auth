import type { SetupSession, SetupSessionStore } from './types';

const cloneSession = (value: SetupSession): SetupSession => ({
	...value,
	capabilities: [...value.capabilities]
});

export const createInMemorySetupSessionStore = (): SetupSessionStore => {
	const sessions = new Map<string, SetupSession>();

	return {
		deleteSetupSession: async (setupSessionId) => {
			sessions.delete(setupSessionId);
		},
		getSetupSessionByTokenHash: async (tokenHash) => {
			const session = [...sessions.values()].find(
				(entry) => entry.tokenHash === tokenHash
			);

			return session ? cloneSession(session) : undefined;
		},
		saveSetupSession: async (session) => {
			sessions.set(session.setupSessionId, cloneSession(session));
		}
	};
};
