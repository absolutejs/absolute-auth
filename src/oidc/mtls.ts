// RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens.
// We implement the `self_signed_tls_client_auth` variant: the client registers one or more
// certificate thumbprints (SHA-256 over the DER bytes, base64url-encoded), and the token
// endpoint matches the inbound cert's thumbprint against that list. PKI mode (CA-chain
// validation against a registered subject DN) follows when a consumer asks for it; the
// self-signed variant covers the typical FAPI 2.0 baseline + healthcare / banking RP
// onboarding use cases without dragging in cert-chain plumbing.
//
// We don't terminate TLS — consumers run behind a reverse proxy (nginx / Envoy / Caddy /
// AWS ALB) which extracts the client cert and forwards it via header. The consumer wires
// an `extractTlsClientCert(headers)` hook on the config; we default to RFC 9440's
// `Client-Cert: :<base64-DER>:` (sf-binary) format if the hook is omitted.

const RFC9440_HEADER = 'client-cert';
const SF_BINARY_PREFIX = ':';
const SF_BINARY_SUFFIX = ':';

const base64Decode = (value: string) =>
	Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

const base64UrlEncode = (bytes: Uint8Array) => {
	const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

	return btoa(binary)
		.replace(/\+/gu, '-')
		.replace(/\//gu, '_')
		.replace(/=+$/u, '');
};

// SHA-256 thumbprint of the cert's DER bytes, base64url-encoded — the `x5t#S256` value
// the cnf claim of a certificate-bound access token will carry (RFC 8705 §3).
export const computeCertThumbprint = async (derBytes: Uint8Array) => {
	const digest = await crypto.subtle.digest('SHA-256', derBytes);

	return base64UrlEncode(new Uint8Array(digest));
};

// Default RFC 9440 sf-binary extractor: `Client-Cert: :<base64>:`. Returns undefined if
// the header is missing or malformed.
export const extractRfc9440ClientCert = (headers: Headers) => {
	const raw = headers.get(RFC9440_HEADER);
	if (raw === null) return undefined;
	const trimmed = raw.trim();
	if (
		!trimmed.startsWith(SF_BINARY_PREFIX) ||
		!trimmed.endsWith(SF_BINARY_SUFFIX) ||
		trimmed.length <= 2
	) {
		return undefined;
	}
	try {
		return base64Decode(trimmed.slice(1, -1));
	} catch {
		return undefined;
	}
};

// Top-level extractor: prefer the consumer's hook (handles Envoy / AWS ALB / nginx
// quirks), fall back to the RFC 9440 default.
export const resolveClientCert = async ({
	extract,
	headers
}: {
	extract:
		| ((
				headers: Headers
		  ) => Promise<Uint8Array | undefined> | Uint8Array | undefined)
		| undefined;
	headers: Headers;
}) => {
	if (extract !== undefined) return extract(headers);

	return extractRfc9440ClientCert(headers);
};

// Resource-server-side helper: verifies that an inbound access token claiming a
// certificate binding (cnf.x5t#S256) was presented over a TLS connection whose client
// cert matches that thumbprint. Pair with `verifyJwt` to authenticate the token itself.
export const verifyCertificateBoundToken = async ({
	cnfThumbprint,
	extract,
	headers
}: {
	cnfThumbprint: string | undefined;
	extract:
		| ((
				headers: Headers
		  ) => Promise<Uint8Array | undefined> | Uint8Array | undefined)
		| undefined;
	headers: Headers;
}) => {
	if (cnfThumbprint === undefined) return false;
	const cert = await resolveClientCert({ extract, headers });
	if (cert === undefined) return false;
	const presented = await computeCertThumbprint(cert);

	return presented === cnfThumbprint;
};
