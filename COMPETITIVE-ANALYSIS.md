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
| **Background breach re-scan (HIBP emails)** | ✅ | ✖ | ✅ (CG) | ✖ | ✖ | ✖ |
| **Inactive-user prune orchestrator** | ✅ | ✖ | ◐ | ✖ | ✖ | ✖ |
| Passwordless (magic link / OTP) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Passkeys / WebAuthn | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Passkey autofill + upgrade-prompt composables (4 fw)** | ✅ | ◐ | ◐ | ◐ | ✖ | ◐ |
| MFA (TOTP + backup) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Enterprise SSO (SAML + OIDC) | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ |
| SCIM / directory sync | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ |
| **SCIM attribute mapping + /Schemas + /ResourceTypes** | ✅ | ◐ | ✅ | ◐ | ◐ | ✖ |
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
| **mTLS client auth + cert-bound tokens (RFC 8705)** | ✅ | ✖ | ◐ | ✖ | ◐ | ✖ |
| **CIBA poll mode (OIDC backchannel auth)** | ✅ | ✖ | ◐ | ✖ | ✖ | ✖ |
| **FAPI 2.0 baseline-ready** (PAR + JAR + DPoP + mTLS + private_key_jwt) | ✅ | ✖ | ◐ | ✖ | ◐ | ✖ |
| **Verifiable Credentials issuer (OpenID4VCI, SD-JWT VC)** | ✅ | ✖ | ✖ | ✖ | ◐ (KC beta) | ✖ |
| **Verifiable Presentation verifier (OpenID4VP)** | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| **Bitstring Status List (VC revocation)** | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| Self-hosted JWKS / own your keys | ✅ | ✖ | ✖ | ✖ | ✅ | ✅ |
| Admin impersonation | ✅ | ✅ | ✅ | ◐ | ✖ | ◐ |
| Adaptive / risk-based auth | ✅ | ✅ | ✅ | ✅ | ✖ | ◐ |
| Bot/abuse protection | ✅ | ✅ (Radar) | ✅ | ✅ | ✖ | ◐ |
| **Device fingerprinting (proprietary-grade)** | ◐ | ✅ | ✅ | ✅ | ✖ | ◐ |
| Account linking | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| GDPR export / erasure | ✅ | ◐ | ✅ | ◐ | ◐ | ✖ |
| MFA encryption-key rotation tool | ✅ | — | — | — | — | ✖ |
| **AI-agent auth (token exchange / MCP / OBO)** | ✅ | ◐ (FGA) | ✅ (Auth for MCP) | ✅ (Connected Apps) | ◐ (Hydra) | ✅ |
| **Multi-session (switch accounts)** | ✅ | ◐ | ◐ | ◐ | ◐ | ✅ |
| **Anonymous / guest → upgrade** | ✅ | ✖ | ◐ | ◐ | ✖ | ✅ |
| Email deliverability validation | ✅ | ✖ | ◐ | ◐ | ✖ | ✅ |
| Proactive credential-leak monitoring | ◐ | ✖ | ✅ (Credential Guard) | ◐ | ✖ | ✖ |
| Extensibility pipeline (Actions/Rules) | ✅ | ◐ | ✅ (Actions) | ◐ | ◐ | ✅ (plugins) |
| Secrets Vault (encrypted blob storage) | ✅ | ✅ (Vault) | ◐ | ◐ | ✖ | ✖ |
| Custom JWT claims on issued tokens | ✅ | ✅ | ✅ (Actions) | ✅ | ✅ | ◐ |
| JIT / domain-based org assignment | ✅ | ✅ (HRD) | ✅ | ✅ | ◐ | ◐ |
| Hosted UI / drop-in components | — by design | ✅ (AuthKit) | ✅ (Universal Login) | ✅ | ✅ (Kratos UI) | ◐ |
| UI integration primitives (client + hooks/composables, 4 fw) | ✅ | ◐ | ✅ | ✅ | ◐ | ✅ |
| **OpenTelemetry instrumentation (CNCF standard)** | ✅ | ◐ (proprietary) | ◐ (proprietary) | ◐ (proprietary) | ◐ | ✖ |
| **Drizzle migrations + first-party CLI** | ✅ | — | — | — | ◐ (manual SQL) | ◐ |
| Per-MAU / per-check pricing | none | yes | yes | yes | none (OSS) | none (OSS) |
| Vendor SOC 2 / hosted infra | — | ✅ | ✅ | ✅ | — | — |

## Where we already lead (most/all competitors lack)
- **Verifiable Credentials full stack** — issuer (OpenID4VCI + SD-JWT VC) + verifier (OpenID4VP) + revocation (Bitstring Status List). **First OSS TypeScript auth library to ship the complete `issue → present → verify → revoke` loop.** Keycloak is doing it (issuer beta only); Logto announced a beta; nobody else in the OSS TS ecosystem has it.
- **FAPI 2.0 baseline-ready** — PAR (9126) + JAR (9101) + DPoP (9449) + mTLS (8705) + cert-bound tokens + private_key_jwt + DCR. The full open-banking/healthcare/regulated-industry profile. Among self-hosted competitors, only Hydra comes close — and they ship none of the SCIM, audit-integrity, or VC pieces.
- **CIBA poll mode (OIDC backchannel auth)** — the "approve on your phone" flow for high-trust scenarios (banking, healthcare, call-center). Auth0 has it; we're the only OSS implementation.
- **Tamper-evident, hash-chained audit log** with `verifyAuditChain` — no major vendor advertises log integrity.
- **DPoP (RFC 9449) sender-constrained tokens**, self-hosted — rare even among the big players.
- **Self-hosted OIDC provider keys** (own your JWKS; no `api.workos.com`).
- **Background ops** — `runEmailBreachScan` re-scans user emails against HIBP on a schedule (Auth0's Credential Guard but for emails); `pruneInactiveUsers` walks the population and orchestrates deletion. Most vendors leave this to the customer.
- **OpenTelemetry instrumentation** — CNCF vendor-neutral, opt-in via optional peer dep. Most competitors ship proprietary observability hooks; we ship the standard everyone else exports to.
- **First-party Drizzle migrations + `bunx absolute-auth migrate` CLI** — 19 idempotent blocks. Ory ships manual SQL; everyone else is SaaS so it's N/A.
- **Dependency-light, in-house crypto**, no per-MAU/per-check pricing, full data ownership.
- **MFA encryption-key rotation** as a turnkey op.
- **Passkey composables across 4 frameworks** (React + Vue + Solid + Svelte) — autofill + upgrade-prompt patterns with `@simplewebauthn/browser` as an optional peer dep. Big-vendor passkey support exists but as hosted UI rather than composable primitives.

## Post-0.40 standing (2026-05-27)

**Feature-complete vs every self-hosted competitor** on the OAuth2/OIDC + enterprise auth surface — every gap row from the original matrix is now ✅ except deliberate non-goals (hosted UI components, hosted infra, vendor SOC 2, cross-customer reputation network).

**First-to-ship in the OSS TypeScript ecosystem** for: Verifiable Credentials (full loop), FAPI 2.0 baseline, CIBA, tamper-evident audit, OpenTelemetry-standard observability.

**Deliberate non-goals** that stay non-goals: hosted infrastructure, drop-in component library, cross-customer reputation data network, hosted plugin marketplace, vendor SOC 2 attestation. These are SaaS-shaped properties; the consumer-owned shape is hooks + a thin client + their own ops.

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
- **Default device fingerprint** — ✅ SHIPPED (beta.9). `fingerprintDevice(signals)` hashes client signals into a stable `deviceId` (better default than UA-only).
- **CAPTCHA provider adapters** — ✅ SHIPPED (beta.10). `verifyTurnstile` / `verifyRecaptcha` (v3 minScore) / `verifyHcaptcha` plug into the abuse guard's `verifyCaptcha`. Bot/abuse row → ✅ (data-network fingerprinting remains the ◐, a non-goal for a self-hosted lib).
- **FGA check cache** — ✅ SHIPPED (beta.10). `createInMemoryCheckCache` (TTL + max-entries) memoizes `check`; writes clear it. A shared/Redis cache for multi-instance is the remaining extension.
- **Audit → retention + CSV export** — ✅ SHIPPED (beta.9). `exportAuditCsv` + `AuditSink.prune` (retention window). Tiered/rotation policies are still open.
- **Actions/Rules extensibility pipeline** — ✅ SHIPPED (beta.11). `createActionPipeline` runs ordered actions per event with deny/pass/redirect short-circuiting — Auth0 Actions / Better Auth plugins from raw primitives.
- **Managed Vault block** — ✅ SHIPPED (beta.11). `createVault` (put/get/list/delete encrypted blobs per owner) on top of `createSecretCipher`, in-mem + Neon stores, `rotateVaultKey` mirrors the MFA-key rotation.
- **OIDC custom claims** — ✅ SHIPPED (beta.11). `getAccessTokenClaims` hook merges consumer claims into the access token; reserved keys protected.
- **JIT / domain-based org assignment** — ✅ SHIPPED (beta.11). `autoAssignOrgsByEmail` idempotently joins a new user to every org their email domain maps to.
- **UI primitives (client + React hooks)** — ✅ SHIPPED (beta.12). `createAuthClient` (framework-agnostic SDK over every endpoint, `{data, error}`, configurable routes) + a `./react` sub-export with thin hooks (`useSignIn`, `useSignUp`, `useSignOut`, `useMfaChallenge`, `useMagicLink`, `usePasswordReset`, `useSessions`). Components are explicitly NOT shipped — primitives + composables let consumers build whatever they want with their own forms/styling (HTMX is the special case because `hx-*` IS the abstraction). Vue/Solid/Svelte composables wrap the same client next.
- **OAuth2 IdP completeness — introspect + revoke + device flow** — ✅ SHIPPED (0.28.0). The OIDC provider now serves the three remaining standards a complete IdP is expected to have: `/oauth2/introspect` (RFC 7662 — JWT-verify access tokens, hash-lookup refresh tokens), `/oauth2/revoke` (RFC 7009 — refresh tokens deleted; access tokens 200-OK per spec allowance, matching Google), and `/oauth2/device_authorization` + `urn:ietf:params:oauth:grant-type:device_code` (RFC 8628 — for CLIs, smart TVs, IoT). All three endpoints + the `device_code` grant are advertised in `/.well-known/openid-configuration` and gated cleanly: introspect/revoke are always on; the device flow is opt-in via `oidc.deviceAuthorizationStore` (in-memory + Postgres/Neon stores ship in the package). The verification UI is consumer-built — the package exposes `/oauth2/device/decision` as an authenticated approve/deny endpoint your verification page hits. Closes the last spec gap relative to WorkOS Connect, Auth0, and Keycloak.
- **Webhooks: retry + DLQ + per-endpoint event filter** — ✅ SHIPPED (0.29.0). The existing Standard-Webhooks-compatible block now retries failed deliveries (3 attempts × exponential backoff by default, configurable), persists permanent failures to a DLQ for inspection/replay (`WebhookDeliveryStore`, in-mem + Postgres/Neon), and lets each endpoint subscribe to a filtered `AuditEventType[]` so different consumers can listen for different events. Matches Stripe/Svix/Auth0 operational shape.
- **OIDC RP-initiated + back-channel logout** — ✅ SHIPPED (0.29.0). `GET/POST /oauth2/end_session` (OIDC Session Management 1.0) honors a verified `id_token_hint` + clears the user session + redirects to an allow-listed `post_logout_redirect_uri`. Back-channel logout (OIDC BCL 1.0 + RFC 8417): fans out signed `logout_token` JWTs to every RP with a `backchannel_logout_uri` registered, failures persist to a DLQ. Front-channel deferred; sub-based "logout everywhere" semantics.
- **`private_key_jwt` client auth (RFC 7521/7523)** — ✅ SHIPPED (0.29.0). Clients register a JWKS (inline `jwks` or fetched `jwksUri`) + sign a `client_assertion` JWT at the token endpoint. Validates sig + `iss === sub === client_id` + audience + expiry + `jti` replay via `ClientAssertionJtiStore`. Stronger than `client_secret_*` — no shared secret to leak. Required by FAPI / Microsoft Entra / Apple Business.
- **Dynamic Client Registration (RFC 7591/7592)** — ✅ SHIPPED (0.29.0). `POST /oauth2/register` with metadata returns `{client_id, registration_access_token, registration_client_uri}`. `GET/PUT/DELETE /oauth2/register/{client_id}` for self-service management (PUT rotates the reg token in the same response). Optional `onClientRegistration` policy hook (deny / transform) + optional `initialAccessTokenStore` for closed-federation gating. Federated SaaS pattern Auth0 + Keycloak ship.
- **Pushed Authorization Requests (RFC 9126)** — ✅ SHIPPED (0.29.0). `POST /oauth2/par` mints opaque `request_uri` (90s TTL) keyed to the params; `/authorize?client_id=&request_uri=` replays them. Closes URL-shoving on `/authorize`: sensitive params no longer traverse the browser. Per-client `requirePushedAuthorizationRequests` flag for FAPI-style hardening.
- **DPoP nonces (RFC 9449 §8) + ACR step-up (RFC 9470)** — ✅ SHIPPED (0.29.0). Stateless HMAC'd nonces (sliding 2-min window) — token endpoint issues `DPoP-Nonce` headers on first DPoP request, requires nonce in retry; opt-in via `config.dpopNonce.secret`. RFC 9470: `acr_values` requested at `/authorize`, mapped through `getAcr({user, scopes})`, propagated as `acr` claim in id_token + access_token, preserved across refresh; mismatch → `insufficient_user_authentication` redirect for RP-driven step-up. Discovery emits `acr_values_supported` when configured.
- **OIDC `/userinfo` + `prompt`/`max_age`/`id_token_hint`** — ✅ SHIPPED (0.30.0). Last small OIDC-conformance items. GET/POST `/oauth2/userinfo` verifies the access token + returns `{sub}` plus consumer-supplied claims via the optional `getUserInfo(sub)` hook. `/authorize` honors `prompt=none` (silent renew → `login_required` / `interaction_required` when blocked), `prompt=login|consent` (forces re-auth), `max_age` (re-auth if session is stale), `id_token_hint` (re-auth on sub mismatch). Discovery: `userinfo_endpoint`.
- **Bulk user import + legacy hash adapters** — ✅ SHIPPED (0.30.0). The migration adoption blocker. `importUsers` / `importUser` orchestrators; argon2id + bcrypt flow through `Bun.password.verify` natively (covers ~90% of real-world imports). For the long tail (Auth0 PBKDF2, Cognito SHA-256, custom scrypt): new `CredentialsConfig.passwordVerifier` override + `rehashOnLogin` flag — wrapped legacy hashes verify on first login + auto-upgrade to native Argon2id. Helpers shipped: `verifyAuth0Pbkdf2`, `verifyCognitoSha256`, `isLegacyHash`, `rehashCredentialPassword`.
- **First-party plugins (small named functions, not a framework)** — ✅ SHIPPED (0.30.0). Ships at `@absolutejs/auth/plugins`. Six concrete demonstrations of "plugin = function that matches a hook signature": `slackAlertPlugin`, `discordAlertPlugin`, `pagerdutyAlertPlugin`, `denyDisposableEmailPlugin`, `geoBlockPlugin`, `posthogIdentifyPlugin`. Each ~20-40 LOC. Library half of "marketplace" — no plugin registry / lifecycle abstraction / install command; the npm package IS the platform.
- **Federated identity token vault** — ✅ SHIPPED (0.30.0). Auth0 Token Vault parity built on the existing Vault block. `createFederatedTokenStore(vault)` → `{save, get, list, delete}` per (userId, provider) for third-party API tokens (Google/Slack/etc.). `getOrRefreshFederatedTokens` auto-refreshes via the consumer's citra `refreshAccessToken` when expired. Optional `revoke` callback on delete for upstream RFC 7009.
- **Strong client-side device fingerprinting** — ✅ SHIPPED (0.30.0). The algorithm side of "fingerprint network", fully self-hosted (the cross-customer reputation database stays a SaaS non-goal). New `@absolutejs/auth/fingerprint-client` browser bundle: `collectDeviceFingerprint()` hashes canvas + audio + WebGL + font + screen + timezone + language signals into a stable base64url `deviceId`. Each signal weak alone; the combination is highly stable across sessions for the same browser/device + varies sharply across different ones. Same algorithms FingerprintJS-open-source uses.
- **JAR signed authorize requests (RFC 9101)** — ✅ SHIPPED (0.30.0). Sibling of PAR. `/authorize` accepts `request=<jwt>`, signed by the client's registered JWKS (reuses the private_key_jwt infrastructure from 0.29.0). When valid, the JWT's claims REPLACE all query-string params per §6 — tampering the URL has no effect. `OAuthClient.requireSignedRequestObject` FAPI flag rejects plain query-string calls. Discovery: `request_parameter_supported`, `require_signed_request_object_supported`, `request_object_signing_alg_values_supported: ['ES256']`.
- **SAML 2.0 IdP role** — ✅ SHIPPED (0.30.0). The inverse of the existing SP-side implementation. Makes the package issue assertions to legacy SaaS RPs (Salesforce, Workday, Concur). Same delegation philosophy: package owns routes + SP store + URL building; consumer plugs in a `SamlIdpAdapter` for XML signing/parsing (wraps `@node-saml/node-saml` / `samlify`). Routes: POST/GET `/sso/saml/idp/sso` (SP-initiated HTTP-POST + HTTP-Redirect bindings), GET `/sso/saml/idp/sso/initiate?sp=<entityId>` (IdP-initiated), GET `/sso/saml/idp/metadata`. New `SamlServiceProvider` store (in-mem + Postgres/Neon, new `auth_saml_service_providers` table). Closes the last spec gap relative to Keycloak.

## Honest non-goals (don't chase)
Hosted infrastructure, vendor SOC 2, and a global device-fingerprint data network are
properties of a SaaS, not a self-hosted library. We enable consumers to be compliant and
to own their data; we don't replace a vendor's hosted ops. A **drop-in component library**
is also a deliberate non-goal — components bake opinionated UX decisions; we ship
**primitives** (the client SDK + framework hooks/composables, plus HTMX as the special
case where `hx-*` IS the abstraction) so consumers compose whatever forms/styling they
want. AuthKit/Universal Login/Clerk are the SaaS hosted-login shape; the consumer-owned
shape is hooks + a thin client.

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
