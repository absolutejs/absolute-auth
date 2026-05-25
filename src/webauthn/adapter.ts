// Public-key credential descriptor exchanged with the adapter (exclude / allow lists).
export type WebAuthnCredentialDescriptor = {
	id: string;
	transports?: string[];
};

// Options for `navigator.credentials.create()` / `.get()`. `options` is passed verbatim to the
// browser; `challenge` is the same challenge surfaced separately so the package can stash it for
// the matching verify call without parsing the (opaque) options blob.
export type WebAuthnRegistrationOptions = {
	challenge: string;
	options: Record<string, unknown>;
};

export type WebAuthnAuthenticationOptions = {
	challenge: string;
	options: Record<string, unknown>;
};

// The verified, normalized result of an attestation. `credential` is present iff `verified` — it
// carries exactly what the package persists (no WebAuthn binary types leak out of the adapter).
export type WebAuthnRegistrationResult = {
	credential?: {
		backedUp?: boolean;
		counter: number;
		credentialId: string;
		deviceType?: string;
		publicKey: string;
		transports?: string[];
	};
	verified: boolean;
};

// The verified result of an assertion; `newCounter` is persisted to detect cloned authenticators.
export type WebAuthnAuthenticationResult = {
	newCounter?: number;
	verified: boolean;
};

// WebAuthn attestation/assertion verification (CBOR decoding, COSE public keys, the various
// attestation-statement formats, signature-counter checks) is a security footgun, so the package
// never bundles a WebAuthn library: the consumer supplies an adapter wrapping a vetted dependency
// (e.g. `@simplewebauthn/server`). The package owns the route wiring, challenge lifecycle,
// credential storage, and session minting; the adapter owns the crypto. Browser `response`
// payloads are opaque (`unknown`) — passed straight through to the adapter.
export type WebAuthnAdapter = {
	createAuthenticationOptions: (request: {
		allowCredentials: WebAuthnCredentialDescriptor[];
		rpId: string;
	}) =>
		| Promise<WebAuthnAuthenticationOptions>
		| WebAuthnAuthenticationOptions;
	createRegistrationOptions: (request: {
		excludeCredentials: WebAuthnCredentialDescriptor[];
		rpId: string;
		rpName: string;
		userDisplayName: string;
		userId: string;
		userName: string;
	}) => Promise<WebAuthnRegistrationOptions> | WebAuthnRegistrationOptions;
	verifyAuthentication: (request: {
		credential: {
			counter: number;
			credentialId: string;
			publicKey: string;
			transports?: string[];
		};
		expectedChallenge: string;
		expectedOrigin: string;
		expectedRPID: string;
		response: unknown;
	}) => Promise<WebAuthnAuthenticationResult>;
	verifyRegistration: (request: {
		expectedChallenge: string;
		expectedOrigin: string;
		expectedRPID: string;
		response: unknown;
	}) => Promise<WebAuthnRegistrationResult>;
};
