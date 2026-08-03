import { describe, expect, test } from 'bun:test';
import type { CredentialsConfig } from '../src/credentials/config';
import type {
	CredentialStore,
	CredentialToken
} from '../src/credentials/types';
import { credentialsEmailVerification } from '../src/credentials/emailVerification';
import { credentialsPasswordReset } from '../src/credentials/passwordReset';
import { Elysia } from 'elysia';

type TestUser = { email: string; sub: string };

// A deliberately LAX store: its consume* methods return an EXPIRED token
// instead of filtering it out. The reset/verify routes must reject it anyway
// (defense in depth), so store correctness is never load-bearing.
const laxStoreReturning = (token: CredentialToken): CredentialStore => ({
	consumeResetToken: async () => token,
	consumeVerificationToken: async () => token,
	getCredentialByEmail: async () => undefined,
	saveCredential: async () => undefined,
	saveResetToken: async () => undefined,
	saveVerificationToken: async () => undefined,
	setEmailVerified: async () => undefined
});

const post = (
	app: { handle: (request: Request) => Promise<Response> },
	path: string,
	body: unknown
) =>
	app.handle(
		new Request(`http://localhost${path}`, {
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json' },
			method: 'POST'
		})
	);

describe('expired reset/verify tokens are rejected even by a lax store', () => {
	const expired: CredentialToken = {
		email: 'a@b.com',
		expiresAt: 1,
		tokenHash: 'whatever'
	};
	const config: CredentialsConfig<TestUser> = {
		credentialStore: laxStoreReturning(expired),
		passwordPolicy: { minLength: 8 },
		getUserByEmail: async () => null,
		onCreateCredentialUser: async ({ email }) => ({
			email,
			sub: `user:${email}`
		}),
		onSendEmail: () => undefined
	};

	test('reset-password rejects an expired token the store handed back', async () => {
		const app = new Elysia().use(credentialsPasswordReset(config));
		const res = await post(app, '/auth/reset-password', {
			password: 'a-strong-password',
			token: 'raw-token'
		});
		expect(res.status).toBe(400);
	});

	test('verify-email rejects an expired token the store handed back', async () => {
		const app = new Elysia().use(credentialsEmailVerification(config));
		const res = await post(app, '/auth/verify-email', {
			token: 'raw-token'
		});
		expect(res.status).toBe(400);
	});
});
