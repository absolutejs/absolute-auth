import { describe, expect, test } from 'bun:test';
import {
	computeCertThumbprint,
	extractRfc9440ClientCert,
	resolveClientCert,
	verifyCertificateBoundToken
} from '../src/oidc/mtls';

// RFC 8705 — Mutual-TLS Client Authentication and Certificate-Bound Access Tokens.
// We don't terminate TLS ourselves; the reverse proxy passes the client cert via header.
// These tests cover the standalone helpers — the integration with the token endpoint
// (`self_signed_tls_client_auth` flow) is wired in src/oidc/routes.ts and exercised by
// the existing CIBA + token-flow tests through the build / typecheck path.

const SAMPLE_CERT_BYTES = new Uint8Array([
	0x30, 0x82, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b
]);

const headersWith = (entries: Record<string, string>) => new Headers(entries);

describe('computeCertThumbprint', () => {
	test('emits a stable base64url SHA-256 over the DER bytes', async () => {
		const thumbprint = await computeCertThumbprint(SAMPLE_CERT_BYTES);
		expect(thumbprint).toMatch(/^[A-Za-z0-9_-]+$/u);
		expect(thumbprint.length).toBeGreaterThan(0);
		expect(await computeCertThumbprint(SAMPLE_CERT_BYTES)).toBe(thumbprint);
	});

	test('different cert bytes produce different thumbprints', async () => {
		const other = new Uint8Array([...SAMPLE_CERT_BYTES, 0x99]);
		const first = await computeCertThumbprint(SAMPLE_CERT_BYTES);
		const second = await computeCertThumbprint(other);
		expect(first).not.toBe(second);
	});
});

describe('extractRfc9440ClientCert', () => {
	test('parses Client-Cert: :<base64>: format', () => {
		const base64 = btoa(
			Array.from(SAMPLE_CERT_BYTES, (byte) =>
				String.fromCharCode(byte)
			).join('')
		);
		const headers = headersWith({ 'client-cert': `:${base64}:` });
		const extracted = extractRfc9440ClientCert(headers);
		expect(extracted).toBeDefined();
		expect(Array.from(extracted ?? [])).toEqual(
			Array.from(SAMPLE_CERT_BYTES)
		);
	});

	test('returns undefined when header missing', () => {
		expect(extractRfc9440ClientCert(headersWith({}))).toBeUndefined();
	});

	test('returns undefined when header is malformed', () => {
		expect(
			extractRfc9440ClientCert(headersWith({ 'client-cert': 'not-wrapped' }))
		).toBeUndefined();
	});

	test('returns undefined when wrapped value is empty', () => {
		expect(
			extractRfc9440ClientCert(headersWith({ 'client-cert': '::' }))
		).toBeUndefined();
	});
});

describe('resolveClientCert', () => {
	test('prefers the consumer hook when present', async () => {
		const extracted = await resolveClientCert({
			headers: headersWith({}),
			extract: () => new Uint8Array([0xbe, 0xef])
		});
		expect(Array.from(extracted ?? [])).toEqual([0xbe, 0xef]);
	});

	test('falls back to RFC 9440 when no hook', async () => {
		const base64 = btoa(
			Array.from(SAMPLE_CERT_BYTES, (byte) =>
				String.fromCharCode(byte)
			).join('')
		);
		const extracted = await resolveClientCert({
			extract: undefined,
			headers: headersWith({ 'client-cert': `:${base64}:` })
		});
		expect(Array.from(extracted ?? [])).toEqual(
			Array.from(SAMPLE_CERT_BYTES)
		);
	});
});

describe('verifyCertificateBoundToken', () => {
	test('returns true when inbound cert thumbprint matches cnf claim', async () => {
		const thumbprint = await computeCertThumbprint(SAMPLE_CERT_BYTES);
		const match = await verifyCertificateBoundToken({
			cnfThumbprint: thumbprint,
			headers: headersWith({}),
			extract: () => SAMPLE_CERT_BYTES
		});
		expect(match).toBe(true);
	});

	test('returns false when no cnf claim present', async () => {
		const match = await verifyCertificateBoundToken({
			cnfThumbprint: undefined,
			headers: headersWith({}),
			extract: () => SAMPLE_CERT_BYTES
		});
		expect(match).toBe(false);
	});

	test('returns false when inbound cert thumbprint mismatches cnf claim', async () => {
		const other = new Uint8Array([0x99, 0x88, 0x77]);
		const thumbprint = await computeCertThumbprint(SAMPLE_CERT_BYTES);
		const match = await verifyCertificateBoundToken({
			cnfThumbprint: thumbprint,
			headers: headersWith({}),
			extract: () => other
		});
		expect(match).toBe(false);
	});

	test('returns false when no cert is presented at all', async () => {
		const thumbprint = await computeCertThumbprint(SAMPLE_CERT_BYTES);
		const match = await verifyCertificateBoundToken({
			cnfThumbprint: thumbprint,
			headers: headersWith({}),
			extract: () => undefined
		});
		expect(match).toBe(false);
	});
});
