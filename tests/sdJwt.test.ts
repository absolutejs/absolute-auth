import { describe, expect, test } from 'bun:test';
import { generateSigningKey } from '../src/oidc/keys';
import {
	issueSdJwtVc,
	parseSdJwtVc,
	presentSdJwtVc,
	verifySdJwtVc
} from '../src/vc/sdJwt';

// SD-JWT VC = `<jwt>~<disclosure1>~<disclosure2>~…~[kb_jwt]`. The issuer puts salted hashes
// of each selectively-disclosable claim into `_sd`; the holder presents only the disclosures
// they're willing to reveal; the verifier rehashes each one and checks membership.

const ISSUER = 'https://issuer.example';
const VCT = 'https://credentials.example/identity_v1';

describe('SD-JWT VC — issue + parse + verify', () => {
	test('round-trips every selective claim when the holder presents them all', async () => {
		const issuerKey = await generateSigningKey();
		const token = await issueSdJwtVc({
			base: { iss: ISSUER, vct: VCT },
			selective: {
				birthdate: '1990-01-15',
				family_name: 'Doe',
				given_name: 'Jane',
				is_over_21: true
			},
			signingKey: issuerKey
		});

		const parsed = parseSdJwtVc(token);
		expect(parsed.disclosures).toHaveLength(4);
		expect(parsed.keyBindingJwt).toBeUndefined();

		const verified = await verifySdJwtVc({
			issuerPublicJwk: issuerKey.publicJwk,
			token
		});
		expect(verified).toBeDefined();
		expect(verified?.protectedClaims).toEqual({ iss: ISSUER, vct: VCT });
		expect(verified?.disclosedClaims).toEqual({
			birthdate: '1990-01-15',
			family_name: 'Doe',
			given_name: 'Jane',
			is_over_21: true
		});
	});

	test('selective disclosure: holder presents only is_over_21', async () => {
		const issuerKey = await generateSigningKey();
		const token = await issueSdJwtVc({
			base: { iss: ISSUER, vct: VCT },
			selective: {
				birthdate: '1990-01-15',
				given_name: 'Jane',
				is_over_21: true
			},
			signingKey: issuerKey
		});

		const parsed = parseSdJwtVc(token);
		const presentation = presentSdJwtVc(parsed, ['is_over_21']);

		const verified = await verifySdJwtVc({
			issuerPublicJwk: issuerKey.publicJwk,
			token: presentation
		});
		expect(verified?.disclosedClaims).toEqual({ is_over_21: true });
		// birthdate + given_name are NOT revealed
		expect(verified?.disclosedClaims).not.toHaveProperty('birthdate');
		expect(verified?.disclosedClaims).not.toHaveProperty('given_name');
	});

	test('holder binding: cnf.jwk is surfaced when the issuer added it', async () => {
		const issuerKey = await generateSigningKey();
		const holderKey = await generateSigningKey();
		const token = await issueSdJwtVc({
			base: { iss: ISSUER, vct: VCT },
			holderJwk: holderKey.publicJwk,
			selective: { given_name: 'Jane' },
			signingKey: issuerKey
		});

		const verified = await verifySdJwtVc({
			issuerPublicJwk: issuerKey.publicJwk,
			token
		});
		expect(verified?.cnf?.jwk.x).toBe(holderKey.publicJwk.x);
		expect(verified?.cnf?.jwk.y).toBe(holderKey.publicJwk.y);
	});

	test('rejects a token signed by a different issuer key', async () => {
		const realKey = await generateSigningKey();
		const attackerKey = await generateSigningKey();
		const token = await issueSdJwtVc({
			base: { iss: ISSUER, vct: VCT },
			selective: { given_name: 'Jane' },
			signingKey: attackerKey
		});

		const verified = await verifySdJwtVc({
			issuerPublicJwk: realKey.publicJwk,
			token
		});
		expect(verified).toBeUndefined();
	});

	test('rejects when a disclosure is tampered with (hash no longer matches _sd)', async () => {
		const issuerKey = await generateSigningKey();
		const token = await issueSdJwtVc({
			base: { iss: ISSUER, vct: VCT },
			selective: { is_over_21: true },
			signingKey: issuerKey
		});
		const parsed = parseSdJwtVc(token);

		// Forge a disclosure that wasn't in the original `_sd` array.
		const forgedDisclosure = Buffer.from(
			JSON.stringify(['fakesalt', 'is_over_21', false])
		).toString('base64url');
		const tampered = `${parsed.jwt}~${forgedDisclosure}~`;

		const verified = await verifySdJwtVc({
			issuerPublicJwk: issuerKey.publicJwk,
			token: tampered
		});
		expect(verified).toBeUndefined();
	});

	test('parses a presentation with a key-binding JWT in the last segment', async () => {
		const issuerKey = await generateSigningKey();
		const holderKey = await generateSigningKey();
		const token = await issueSdJwtVc({
			base: { iss: ISSUER, vct: VCT },
			holderJwk: holderKey.publicJwk,
			selective: { given_name: 'Jane' },
			signingKey: issuerKey
		});
		const parsed = parseSdJwtVc(token);
		const kbJwt = 'mock.kb.jwt';
		const presentation = presentSdJwtVc(parsed, ['given_name'], kbJwt);

		const parsedPresentation = parseSdJwtVc(presentation);
		expect(parsedPresentation.keyBindingJwt).toBe(kbJwt);
		expect(parsedPresentation.disclosures).toHaveLength(1);
	});
});
