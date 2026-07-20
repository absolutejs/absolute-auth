# Agent authentication and registration

Absolute Auth implements agent registration inside `@absolutejs/auth`. There is
no separate `auth-md` package and no WorkOS service dependency. `/auth.md` is a
wire-compatible, generated companion document; OAuth metadata remains the
authoritative machine-readable contract.

For applications that use ordinary OAuth dynamic client registration rather
than the claim/ID-JAG profile, `agentAuth.oauthGuide` publishes the same native
`/auth.md` surface from an exact list of enabled protected resources, metadata
URLs, and scopes. RFC 8414 discovery links it through
`service_documentation`. The guide never creates a second credential type or
changes the application's audience-bound OAuth verification.

## Interoperability contract

The implementation composes existing standards wherever they already define the
behavior:

- RFC 9728 protected-resource discovery
- RFC 8414 authorization-server discovery
- RFC 7523 JWT bearer grants
- RFC 8628-style user-code polling semantics
- RFC 9396-compatible authorization details in agent delegations
- the auth.md v0.6 registration projection and ID-JAG assertion type

The auth.md claim grant currently has a WorkOS-namespaced URN because that is the
identifier in the open v0.6 wire profile. It is isolated behind
`AGENT_CLAIM_GRANT_TYPE`; it does not indicate a WorkOS backend dependency. A
future neutral identifier can be accepted alongside it without changing the
internal store, verifier, or client contracts.

Protocol inputs are normalized into provider-neutral Absolute types. Identity
verification, user resolution, stores, key management, and token revocation are
injected interfaces. Provider adapters can therefore be added without changing
routes or application authorization logic.

## Security invariants

- The service owns the account-linking page. Agents never receive passwords,
  MFA codes, or service session cookies.
- ID-JAG assertions are signature-, issuer-, audience-, client-, freshness-,
  verification-, and replay-checked before identity resolution.
- A durable identity key includes issuer, subject, and client id. Different
  agents acting for the same user cannot collapse into one registration.
- Claim and attempt tokens are stored only as hashes. User codes have bounded
  attempts, short expirations, constant-time comparison, and atomic updates.
- Polling is rate-enforced and returns `slow_down` when the advertised interval
  is ignored.
- Access tokens are opaque, scoped, short-lived, and looked up in a revocable
  store. Anonymous pre-claim credentials must be revoked before ownership is
  committed.
- Structured discovery never advertises an optional capability, such as
  security-event delivery, unless the deployment actually implements it.

## Deployment checklist

Use the Postgres identity-registration store in production, run the `agents`
migrations, keep signing keys in managed key storage, make anonymous-token
revocation idempotent, pin trusted assertion issuers and client ids, and apply
normal edge rate limits to identity, claim, completion, and token routes.
