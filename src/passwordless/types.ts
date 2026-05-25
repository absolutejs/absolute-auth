export type PasswordlessToken = {
	email: string;
	expiresAt: number;
	// SHA-256 hash of the magic-link token, or of `${email}:${code}` for OTP (so a short code is
	// globally unique and can't collide across users). The plaintext is never stored.
	tokenHash: string;
};

// Single-use token storage for passwordless login. `consumeToken` must atomically return AND
// delete the matching token (single use). Mirrors the credential token pattern.
export type PasswordlessTokenStore = {
	consumeToken: (tokenHash: string) => Promise<PasswordlessToken | undefined>;
	saveToken: (token: PasswordlessToken) => Promise<void>;
};
