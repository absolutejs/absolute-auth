# Durable WebAuthn ceremonies

WebAuthn routes store short-lived, single-use ceremony records server-side. The
HTTP-only challenge cookie contains an opaque record identifier. Verification
atomically consumes the record before calling the cryptographic adapter. Records
are bound to the ceremony purpose and starting session; registration also binds
the authenticated user. Cookie deletion alone is not replay protection.

Single-process development defaults to `createInMemoryWebAuthnChallengeStore()`.
Production and multi-instance deployments should apply the `webauthn` migration
block and pass `challengeStore: createPostgresWebAuthnChallengeStore(db)` alongside
the PostgreSQL credential store. The additive `0002_server_challenges` migration
preserves existing passkeys. In-progress ceremonies from older versions must be
restarted after upgrading.

The same challenge store supports `purpose: 'approval'` for applications using
the Agent Exchange WebAuthn approval provider. Bind these challenges to both the
signed-in user and session, and consume before verifying the assertion. Do not
use the approval challenge as a login challenge.

Use `canRegister(user)` to recheck current account eligibility before options and
verification. `getWebAuthnUser` must likewise reject disabled users during login.
Credential stores reject attempts to transfer an existing credential to another
user, replace its public key, or decrease its signature counter.

Expired database records may be deleted where `expires_at <= now`; deletion must
never recreate an identifier. No automatic cleanup worker is installed by Auth.
