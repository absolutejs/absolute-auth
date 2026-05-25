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
| Fine-grained authz (ReBAC/Zanzibar) | ✅ v1 | ✅ | ✅ (FGA) | ◐ | ✅ (Keto) | ◐ |
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
| **Device fingerprinting (proprietary-grade)** | ✖ | ✅ | ✅ | ✅ | ✖ | ◐ |
| Account linking | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GDPR export / erasure | ✅ | ◐ | ✅ | ◐ | ◐ | ✖ |
| MFA encryption-key rotation tool | ✅ | — | — | — | — | ✖ |
| **AI-agent auth (token exchange / MCP / OBO)** | ✖ | ◐ (FGA) | ✅ (Auth for MCP) | ✅ (Connected Apps) | ◐ (Hydra) | ✅ |
| **Multi-session (switch accounts)** | ✖ | ◐ | ◐ | ◐ | ◐ | ✅ |
| **Anonymous / guest → upgrade** | ✖ | ✖ | ◐ | ◐ | ✖ | ✅ |
| Email deliverability validation | ✖ | ✖ | ◐ | ◐ | ✖ | ✅ |
| Proactive credential-leak monitoring | ✖ | ✖ | ✅ (Credential Guard) | ◐ | ✖ | ✖ |
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

1. **AI-agent auth — the 2026 frontier.** Auth0 shipped "Auth for MCP" (GA May 2026);
   Better Auth, Stytch (Connected Apps), and WorkOS (FGA-for-agents) all lean in. The
   MCP authorization spec is just OAuth 2.1 + **Resource Indicators (RFC 8707)** +
   **Token Exchange (RFC 8693)** for on-behalf-of delegation. **We're one extension away**
   — our OIDC provider already does authorization_code + PKCE + JWKS. Add: a
   `urn:ietf:params:oauth:grant-type:token-exchange` grant (trade a user token for a
   narrow, short-lived, audience-bound agent token), `resource`/audience binding, and an
   MCP `protected-resource` discovery doc. Highest-leverage gap.
2. **Device fingerprinting (proprietary-grade).** Stytch (99.99% bot detection), WorkOS
   Radar, Auth0 all ship data-network fingerprints. We ship the framework + hooks only.
   Can't match their data, but can: ship a stronger default fingerprint (FP-JS-style
   signal hashing) + first-class adapters for Stytch/Cloudflare Turnstile/etc.
3. **Multi-session (multiple accounts, switch).** Better Auth has it; common consumer
   need. Extend the session store/cookie model to hold N sessions + an active selector.
4. **Anonymous / guest sessions that upgrade to a real account.** Better Auth has it;
   useful for trials/carts. Extend: mint a guest session, merge on register/login.
5. **Proactive credential-leak monitoring.** Auth0 Credential Guard monitors the dark
   web and notifies on post-hoc compromise (we only check at register/reset). Extend:
   a `monitorBreaches` hook + an audit/webhook event + a notify path.
6. **Email deliverability validation** (disposable/typo/MX). Extend: a `validateEmail`
   hook on register + a sensible default (disposable-domain list + MX check).
7. **Extensibility pipeline (Actions/Rules).** Auth0 Actions / Better Auth plugins offer
   an ordered, composable pipeline. We have per-event lifecycle hooks (◐). Extend: a
   documented `onAuthAction` pipeline (ordered middleware over the auth lifecycle).
8. **Hosted/drop-in UI.** Clerk, AuthKit, Universal Login. We're headless by design
   (◐ via the HTMX fragments + `@absolutejs/auth/ui`). Optional: a richer prebuilt UI kit.

## Features to extend (deepen what we have)
- **OIDC provider → AI-agent auth** (token exchange + resource indicators + MCP discovery) — see gap #1.
- **Adaptive auth → weighted risk scoring** (Auth0-style configurable signal weights) on top of the current rules; more signals (ASN/proxy, time-of-day).
- **FGA → schema-language parser + reverse `listObjects`** ("what can this subject access?") + a check-results cache for throughput.
- **Bot/abuse → default fingerprint + CAPTCHA provider adapters** (Turnstile/reCAPTCHA/hCaptcha out of the box).
- **Audit → retention/rotation + CSV export helpers** (WorkOS has tiered retention + CSV).

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
