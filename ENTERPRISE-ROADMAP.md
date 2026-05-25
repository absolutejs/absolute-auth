# Enterprise Roadmap — matching & exceeding WorkOS

The post-MFA enterprise surface (SSO, SCIM, audit, orgs, RBAC, portal, MFA,
magic-link, webhooks, passkeys, breach detection, adaptive risk, API keys/M2M,
Redis sessions, step-up, MFA key rotation, GDPR export/erasure, account linking)
is **at or beyond WorkOS parity**. This doc tracks the remaining frontiers.

Build order (quick wins first, the two big ones last): **#2 → #3 → #4 → #1 → #5.**
FGA (#5) is deliberately last (separate-product-scale).

Decisions (defaults, adjust anytime):
- OIDC-provider v1 = authorization_code + PKCE + id_token/JWKS/discovery + client
  registry + consent + refresh-token rotation. DPoP deferred to v2.
- FGA = Zanzibar-style ReBAC (warrants + check/query + inheritance), Postgres-backed.

Legend: ☐ todo · ◐ in progress · ☑ done

---

## #2 — Admin impersonation ☑ (shipped)
**WorkOS:** admin-gated, **reason required**, session carries `impersonator`, access
token gets an `act` claim (RFC 8693), recorded on the audit event, off by default.
([docs](https://workos.com/docs/authkit/impersonation))
**Have:** nothing (intent hand-rolled an admin recovery hub).
**Match:** `startImpersonation({ target, impersonator:{ adminId, email, reason } })`
→ session flagged with `impersonator`; surfaced by userStatus/getSessionUser; audit
event; admin-gated by the consumer.
**Exceed:** time-boxed + auto-expiring; **step-up required** to start; one-click exit;
works with the Redis session store; impersonated sessions visibly flagged.
**Size:** small.

## #3 — Tamper-evident audit + SIEM streaming ☐
**WorkOS:** typed event schema, search/CSV export, **Log Streams** to
Datadog/Splunk/S3/GCS/HTTP, retention tiers — *not* tamper-evident.
([audit](https://workos.com/docs/audit-logs) · [log streams](https://workos.com/docs/audit-logs/log-streams))
**Have:** audit block (taxonomy + sinks) + signed webhooks.
**Match:** SIEM streaming via the webhooks dispatcher (Datadog/Splunk/S3 formatters), export.
**Exceed:** **hash-chained tamper-evident** entries + `verifyAuditChain()` (WorkOS can't
prove logs weren't altered; we can).
**Size:** small–medium.

## #4 — Bot/abuse protection (their "Radar") ☐
**WorkOS:** **Radar** — proprietary 20+ signal device fingerprinting, bot detection
(classifies AI agents vs crawlers), credential-stuffing/brute-force, impossible travel —
**hosted-only** (AuthKit forms). ([docs](https://workos.com/docs/authkit/radar))
**Have:** adaptive risk engine (impossible travel, new-device, velocity) + lockout.
**Match:** CAPTCHA hook + IP allow/deny on register/login, bot-classification hook,
fingerprint signal intake.
**Exceed:** self-hosted (Radar is hosted-only); composes with the adaptive engine.
**Honest caveat:** WorkOS's fingerprint quality comes from their data network — we ship
the **framework + hooks**, not a proprietary fingerprint.
**Size:** medium.

## #1 — OAuth2/OIDC provider ("Sign in with <yourapp>") ☐
**WorkOS:** "OAuth Applications" — your app becomes an OAuth/OIDC provider; issues JWT
access/id tokens verified via hosted JWKS (`api.workos.com/sso/jwks/<clientId>`).
([docs](https://workos.com/docs/authkit/connect/oauth))
**Have:** the *consumer* side (verify external IdPs' JWKS for SSO). Not the provider side.
**Match:** `/oauth2/authorize` (authorization_code + PKCE), `/oauth2/token`, `/oauth2/jwks`,
`/.well-known/openid-configuration`, relying-party client registry, consent.
**Exceed:** fully **self-hosted JWKS** (own your keys, no api.workos.com); PKCE-mandatory;
**refresh-token rotation**; **DPoP** (RFC 9449, v2); IdP login composes with our
passkeys/MFA/SSO blocks.
**Size:** big — the platform-defining one.

## #5 — Fine-grained authorization (their FGA) ☐ — LAST
**WorkOS:** **FGA** — Zanzibar-style ReBAC: resource types + schema language, **warrants**
(relationship tuples), **Check** + **Query** APIs, inheritance rules, roles embedded in
access tokens, "millions of checks/sec," pitched as the authz layer for AI agents.
([docs](https://workos.com/docs/fga))
**Have:** RBAC + an ABAC `hasPermission` hook (no relationships).
**Match:** Postgres-backed warrant store, schema/resource-types, check + query, inheritance.
**Exceed:** self-hosted (no per-check pricing); layers on the existing roles block.
**Honest caveat:** matching Zanzibar's scale/tooling is a real undertaking — v1 = a correct
ReBAC engine, not their throughput.
**Size:** largest — separate-product-scale.
