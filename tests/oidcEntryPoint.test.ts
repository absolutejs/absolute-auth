import { describe, expect, test } from 'bun:test';
import {
	createPostgresAuthorizationCodeStore,
	generateSigningKey,
	toPublicJwk,
	verifyJwt
} from '../src/oidc';

describe('OIDC narrow entry point', () => {
	test('exports provider keys, verification, and PostgreSQL stores', async () => {
		const signingKey = await generateSigningKey();

		expect(toPublicJwk(signingKey).kid).toBe(signingKey.kid);
		expect(typeof verifyJwt).toBe('function');
		expect(typeof createPostgresAuthorizationCodeStore).toBe('function');
	});
});
