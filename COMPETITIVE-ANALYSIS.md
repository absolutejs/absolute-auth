# Competitive analysis — `@absolutejs/auth` vs the enterprise-auth market (2026)

Scope: WorkOS, Auth0/Okta, Stytch, Ory (open-source: Kratos+Hydra+Keto), and Better
Auth (the closest TS-native, self-hosted competitor). Clerk/FusionAuth/Descope noted
where relevant. The point is to find **gaps** and **features we can extend**, not to
re-list parity (we reached WorkOS parity-plus in the roadmap).

Legend: ✅ full · ◐ partial / hook-only / BYO · ✖ none · — N/A for a library

## Feature matrix

| Capability | abs/auth | WorkOS | Auth0/Okta | Stytch | Ory (OSS) | Better Auth |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Social / OAuth login | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Credentials + password policy | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Breached-password check (HIBP) | ✅ | ◐ | ✅ | ✅ | ◐ | ◐ |
| Passwordless (magic link / OTP) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Passkeys / WebAuthn | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| MFA (TOTP + backup) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Enterprise SSO (SAML + OIDC) | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ |
| SCIM / directory sync | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ |
| Organizations / multi-tenancy | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ |
| RBAC | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fine-grained authz (ReBAC/Zanzibar) | ✅ | ✅ | ✅ (FGA) | ◐ | ✅ (Keto) | ◐ |
| Audit logs | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ |
| **Tamper-evident audit (hash chain)** | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| SIEM log streaming | ✅ | ✅ | ✅ | ◐ | ◐ | ✖ |
| Signed webhooks | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ |
| Headless admin portal (self-serve SSO setup) | ✅ | ✅ | ◐ | ◐ | ✖ | ✖ |
| Sessions + device management | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Step-up / re-auth | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ |
| API keys + M2M (client_credentials) | ✅ | ✅ | ✅ | ✅ | ✅ (Hydra) | ✅ |
| OAuth2/OIDC **provider** (be an IdP) | ✅ | ✅ | ✅ | ✅ | ✅ (Hydra) | ✅ |
| **DPoP (sender-constrained tokens)** | ✅ | ✖ | ◐ | ✖ | ◐ | ✖ |
| Self-hosted JWKS / own your keys | ✅ | ✖ | ✖ | ✖ | ✅ | ✅ |
| Admin impersonation | ✅ | ✅ | ✅ | ◐ | ✖ | ◐ |
| Adaptive / risk-based auth | ✅ | ✅ | ✅ | ✅ | ✖ | ◐ |
| Bot/abuse protection | ◐ | ✅ (Radar) | ✅ | ✅ | ✖ | ◐ |
| **Device fingerprinting (proprietary-grade)** | ◐ | ✅ | ✅ | ✅ | ✖ | ◐ |
| Account linking | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GDPR export / erasure | ✅ | ◐ | ✅ | ◐ | ◐ | ✖ |
| MFA encryption-key rotation tool | ✅ | — | — | — | — | ✖ |
| **AI-agent auth (token exchange / MCP / OBO)** | ✅ | ◐ (FGA) | ✅ (Auth for MCP) | ✅ (Connected Apps) | ◐ (Hydra) | ✅ |
| **Multi-session (switch accounts)** | ✅ | ◐ | ◐ | ◐ | ◐ | ✅ |
| **Anonymous / guest → upgrade** | ✅ | ✖ | ◐ | ◐ | ✖ | ✅ |
| Email deliverability validation | ✅ | ✖ | ◐ | ◐ | ✖ | ✅ |
| Proactive credential-leak monitoring | ◐ | ✖ | ✅ (Credential Guard) | ◐ | ✖ | ✖ |
| Extensibility pipeline (Actions/Rules) | ◐ (hooks) | ◐ | ✅ (Actions) | ◐ | ◐ | ✅ (plugins) |
| Hosted UI / drop-in components | ◐ (HTMX) | ✅ (AuthKit) | ✅ (Universal Login) | ✅ | ✅ (Kratos UI) | ◐ |
| Per-MAU / per-check pricing | none | yes | yes | yes | none (OSS) | none (OSS) |
| Vendor SOC 2 / hosted infra | — | ✅ | ✅ | ✅ | — | — |

## Where we already lead (most/all competitors lack)
- **Tamper-evident, hash-chained audit log** with `verifyAuditChain` — no major vendor advertises log integrity.
- **DPoP (RFC 9449) sender-constrained tokens**, self-hosted — rare even among the big players.
- **Self-hosted OIDC provider keys** (own your JWKS; no `api.workos.com`).
- **Dependency-light, in-house crypto**, no per-MAU/per-check pricing, full data ownership.
- **MFA encryption-key rotation** as a turnkey op.

## Gaps (ranked by value), with extension path

1. **AI-agent auth — the 2026 frontier. ✅ SHIPPED (beta.5).** The OIDC provider now
   supports the `urn:ietf:params:oauth:grant-type:token-exchange` grant (RFC 8693): an
   agent (authenticated client) trades a user's access token for a narrow, short-lived,
   audience-bound (`resource`/`audience`, RFC 8707) token whose `act` claim records the
   delegation — DPoP-bindable. `mcpProtectedResourceMetadata` emits the MCP/RFC 9728
   discovery doc. `exchangeToken` is exported. Matches Auth0 "Auth for MCP" + Better Auth.
2. **Device fingerprinting (proprietary-grade). ◐ IMPROVED (beta.9).** Stytch (99.99% bot
   detection), WorkOS Radar, Auth0 all ship data-network fingerprints. We now ship a
   dependency-light default — `fingerprintDevice(signals)` hashes client signals into a stable
   `deviceId` feeding the adaptive known-device/new_device signal. We still can't match their
   data network; remaining: first-class adapters for Stytch/Cloudflare Turnstile/etc.
3. **Multi-session (multiple accounts, switch). ✅ SHIPPED (beta.6).** A session-ring
   toolkit (`addToSessionRing` / `listRingSessions` / `switchActiveSession` /
   `removeFromSessionRing`) over a second cookie; active session stays in `user_session_id`.
4. **Anonymous / guest sessions that upgrade. ✅ SHIPPED (beta.6).** `createAnonymousSession`
   flags the session `anonymous`; `isAnonymousSession` detects it; upgrade = a normal login.
5. **Proactive credential-leak monitoring. ◐ PARTIAL (beta.6).** Shipped login-time
   compromised-credential detection (`isPasswordCompromised`, HIBP at sign-in — what Auth0
   does at login). True ongoing dark-web monitoring needs a data feed we don't have.
6. **Email deliverability validation. ✅ SHIPPED (beta.6).** `validateEmailDeliverability`
   (format + disposable-domain block + optional MX) and `isDisposableEmail`.
7. **Extensibility pipeline (Actions/Rules).** Auth0 Actions / Better Auth plugins offer
   an ordered, composable pipeline. We have per-event lifecycle hooks (◐). Extend: a
   documented `onAuthAction` pipeline (ordered middleware over the auth lifecycle).
8. **Hosted/drop-in UI.** Clerk, AuthKit, Universal Login. We're headless by design
   (◐ via the HTMX fragments + `@absolutejs/auth/ui`). Optional: a richer prebuilt UI kit.

## Features to extend (deepen what we have)
- **OIDC provider → AI-agent auth** (token exchange + resource indicators + MCP discovery) — ✅ SHIPPED (beta.5), see gap #1.
- **Adaptive auth → weighted risk scoring** — ✅ SHIPPED (beta.9). `scoreRisk` adds Auth0-style per-signal weights + score thresholds alongside the rule engine, plus `proxy` + `off_hours` signals (consumer-fed `isProxy`/`localHour`).
- **FGA → schema-language parser + reverse `listObjects`** — ✅ SHIPPED (beta.9). `listObjects` ("what can this subject access?") + `parseSchema` (OpenFGA-style DSL → FgaSchema). A check-results cache for throughput is still open.
- **Default device fingerprint** — ✅ SHIPPED (beta.9). `fingerprintDevice(signals)` hashes client signals into a stable `deviceId` (better default than UA-only). CAPTCHA provider adapters (Turnstile/reCAPTCHA/hCaptcha) for the abuse guard are still open.
- **Audit → retention + CSV export** — ✅ SHIPPED (beta.9). `exportAuditCsv` + `AuditSink.prune` (retention window). Tiered/rotation policies are still open.

## Honest non-goals (don't chase)
Hosted infrastructure, vendor SOC 2, and a global device-fingerprint data network are
properties of a SaaS, not a self-hosted library. We enable consumers to be compliant and
to own their data; we don't replace a vendor's hosted ops.

## Sources
WorkOS [FGA](https://workos.com/docs/fga) · [Radar](https://workos.com/docs/authkit/radar) ·
[OAuth Apps](https://workos.com/docs/authkit/connect/oauth) · [Audit Logs](https://workos.com/docs/audit-logs) ·
[Impersonation](https://workos.com/docs/authkit/impersonation). Auth0
[Attack Protection / Adaptive MFA](https://auth0.com/blog/auth0-launches-adaptive-mfa/) ·
[Breached Password](https://auth0.com/docs/secure/attack-protection/playbooks/breached-password-playbook) ·
Auth for MCP (GA 2026-05-06). Stytch [Fraud & Device Fingerprinting](https://stytch.com/docs/fraud-risk/overview) ·
Connected Apps / M2M. Ory [Hydra](https://github.com/ory/hydra) · [Keto](https://github.com/ory/keto) ·
[Kratos](https://github.com/ory/kratos). [Better Auth](https://better-auth.com/docs/introduction).
MCP authorization spec (OAuth 2.1 + RFC 8707 + RFC 8693).
