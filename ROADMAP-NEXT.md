# Roadmap — `@absolutejs/auth` after `0.34.0`

**Status:** scouted 2026-05-27 against the current landscape. Builds on stable `0.34.0`. The OAuth2/OIDC + enterprise auth surface is already feature-complete vs every self-hosted competitor; this scout looks for what's left **vs the broader market** (including hosted players where features can be ported as self-hosted primitives) and what's emerging in the 2026 spec frontier.

The prior planning artifacts — `COMPETITIVE-ANALYSIS.md` (the matrix), `ROADMAP-0.29.md`, `ROADMAP-0.30.md`, `ENTERPRISE-ROADMAP.md` — track work that already shipped. This doc tracks what's next.

---

## Recap: where we stand

We currently match or beat every self-hosted competitor (Ory, Better Auth, Authelia, Authentik, Hanko, Logto, SuperTokens, NextAuth, ZITADEL) on the published feature matrix; we match every hosted competitor (Auth0/Okta, WorkOS, Stytch, Clerk, Kinde, FrontEgg, Descope, FusionAuth) on every feature that can plausibly live in a library instead of a SaaS.

Cumulative spec coverage through `0.34.0`:

- OAuth 2.0 — RFC 6749, 6750, 7009 (revoke), 7521/7523 (private_key_jwt + JWT bearer), 7591/7592 (DCR), 7662 (introspect), 8252 (native apps BCP), 8628 (device flow), 8693 (token exchange), 8707 (resource indicators), 9101 (JAR), 9126 (PAR), 9449 (DPoP + §8 nonces)
- OIDC — Core 1.0, Discovery 1.0, Session Mgmt 1.0, Back-Channel Logout 1.0, RP-Initiated Logout 1.0, prompt/max_age/id_token_hint, /userinfo, acr_values (RFC 9470)
- SAML 2.0 — SP role (consumer) + IdP role (issuer)
- SCIM 2.0 — Users + ServiceProviderConfig (Groups optional)
- MCP — RFC 9728 protected-resource metadata, token-exchange OBO pattern

Everything else (credentials + MFA + WebAuthn + passwordless + sessions + impersonation + adaptive risk + audit + webhooks + vault + federated tokens + plugins + FGA + ReBAC + Redis FGA cache + Vue/Solid/Svelte composables) is in.

---

## Gaps found

Ranked by `(value to consumers) / (work to implement)`. "Value" is biased toward unlocking new categories of consumers, not deepening features for existing ones.

### Tier 1 — high-value, low-to-medium effort

#### G1. OpenTelemetry instrumentation
Every modern auth library a production team picks now is expected to emit OTel spans by default. We currently emit audit events and webhooks, but a consumer's APM (Datadog / Honeycomb / Grafana Tempo / etc.) can't see a `signIn → mfaChallenge → promoteToSession` causal trace without manual `withActiveSpan` wrapping at every call site.

- Add `@opentelemetry/api` as an **optional** peer dep
- Top-level `tracing: { tracerProvider }` config; when set, the package wraps every external action (route handler, store call, hook invocation, webhook delivery) in a span with semantic attributes (`auth.flow`, `auth.user.sub`, `auth.session.id`, `auth.provider`, `http.method`, `http.status_code`)
- Mirror Pyroscope / Sentry conventions for span names: `auth.signin.email`, `auth.oauth.callback`, `auth.mfa.challenge`, etc.
- No runtime cost when the tracer provider is absent (default `noop` from `@opentelemetry/api`)

**Effort:** ~1-2 days; mostly mechanical wrapping with a single helper.
**Beats:** Auth0 (their SDK doesn't ship OTel out of the box). On parity with WorkOS (their tracing is hosted-only).

#### G2. Drizzle migrations shipped as artifacts + `auth migrate` CLI
Right now every consumer hand-writes `CREATE TABLE IF NOT EXISTS auth_session (...)` for every block they enable. That's ~12-15 tables across credentials/MFA/sessions/sso/scim/oidc/webhooks/audit/audit-integrity/vault/federated-tokens/oauth-clients/par/dcr/logout-delivery/saml-sp/webauthn/passwordless. We have the schemas; we just don't ship them.

- Ship Drizzle migrations under `dist/migrations/` indexed by feature block
- New CLI entry `bunx @absolutejs/auth migrate --db $DATABASE_URL --blocks credentials,mfa,sessions,oidc`
- Generates a migration journal so re-runs are no-ops
- Roll-back not supported (auth tables shouldn't drop in prod); just forward

**Effort:** ~1 day. We already have the column definitions in each block's `postgresStores.ts`.
**Beats:** Better Auth (no shipped migrations), Lucia (deprecated path was hand-written), SuperTokens (their migrations are tied to the hosted Core).

#### G3. CIBA (OIDC Client-Initiated Backchannel Authentication, RFC drafts → stable)
Banking + healthcare + government + B2B-internal apps need "user authenticates on phone, action happens on website" flows. The user types a transaction ID at the desktop, the bank pushes a notification to their phone, they approve, the desktop continues. CIBA is the standard.

- New endpoints: `POST /oauth2/bc-authorize` (initiate), `POST /oauth2/token` extends with `grant_type=urn:openid:params:grant-type:ciba`
- Three modes (`poll`, `ping`, `push`) — most consumers want `poll` first
- Requires a consumer hook `onBackchannelAuthRequest(user, hint)` that triggers their out-of-band UI (FCM / APNs / etc.)
- Per-client opt-in via `backchannelTokenDeliveryMode`

**Effort:** ~2-3 days. Reuses token-issuance + JWT-signing infrastructure.
**Beats:** Most self-hosted (ZITADEL ships it, Ory has partial). Hosted (Auth0, ForgeRock) ship it. Lets us land **financial-services-grade auth** without buying a SaaS.

#### G4. mTLS client authentication (RFC 8705)
Financial/government APIs sometimes require X.509 client certs over private_key_jwt. We don't support `tls_client_auth` or `self_signed_tls_client_auth` token-endpoint auth methods.

- Wire-up to read the client's TLS cert from the request (consumer supplies it via header — usually `x-forwarded-client-cert` from a TLS-terminating reverse proxy)
- Verify against the registered `tls_client_auth_subject_dn` or `self_signed_tls_client_auth.x5t#S256`
- Discovery: `token_endpoint_auth_methods_supported` += `['tls_client_auth', 'self_signed_tls_client_auth']`

**Effort:** ~1 day. Validation is pure logic; the cert plumbing is consumer-side.
**Beats:** Better Auth, ZITADEL (don't ship). Required for FAPI 2.0 baseline.

#### G5. Passkey conditional UI + autofill helpers
WebAuthn ships the discovery; the UX win is `mediation: 'conditional'` so the browser surfaces saved passkeys directly in the email field at first focus. Most consumers don't know this exists. We can ship a `usePasskeyAutofill(client)` composable for each framework that wraps `navigator.credentials.get({ mediation: 'conditional' })` correctly and feeds the result through the existing authenticate-verify route.

- Tiny addition to `@absolutejs/auth/{react,vue,solid,svelte}` (~30 LOC each)
- Also ship a `usePasskeyUpgradePrompt(client, user)` that surfaces a UI flag when a password user has NO registered passkeys yet — the upgrade nudge

**Effort:** ~half day. Pure client-side wrapper.
**Beats:** Hanko (passkey-first vendor) at adoption-friction parity.

### Tier 2 — medium value, medium effort

#### G6. Verifiable credentials (OpenID4VP / OpenID4VCI)
**Hot in 2026.** EU eIDAS 2.0 mandates digital identity wallets by 2027; US states are following. OpenID for Verifiable Presentations + OpenID for Verifiable Credential Issuance are the protocols.

- **Verifiable Credential Issuer** (OpenID4VCI): the package becomes an issuer of W3C VCs / SD-JWTs. Users with a wallet (EU Digital Identity Wallet, Apple Wallet planned, Google Wallet planned) can store a credential issued by your IdP.
- **Verifiable Presentation Verifier** (OpenID4VP): the package accepts a presented VC as proof-of-claim alongside or instead of an OIDC login — "prove you're over 18 without telling me your birthday."

This is real future-proofing for EU consumers. We'd be first-to-ship in the OSS TS auth space (Keycloak is doing it; Logto announced a beta).

**Effort:** ~1-2 weeks for a minimal subset. Requires JOSE for SD-JWT + a credential-status mechanism. Worth doing as a dedicated `0.36.0` or `0.40.0` cycle.

#### G7. SCIM enterprise polish
Current SCIM is "Users + ServiceProviderConfig". Real enterprise IT pulls in:
- **Group membership push** (we have the hook but no helpers)
- **Attribute mapping** — the Okta admin's eternal pain. A `defineScimAttributeMap` helper that lets the consumer say "Okta `manager` attr → our `reporting_to` field" declaratively
- **Bulk endpoint** (SCIM bulk is rare in practice; skip)
- **Schemas + ResourceTypes endpoints** (some IdPs probe these; we 501 right now)

**Effort:** ~2-3 days. Mostly schema mappings + the two extra discovery endpoints.

#### G8. Project scaffolder — `bunx @absolutejs/create-auth-app`
**Real adoption friction.** Today, "use @absolutejs/auth" means reading the README + writing your own `defineAuthConfig` + your own Neon/Drizzle wiring + your own Postgres tables. The first 30 minutes are the hard part.

- A scaffolder that asks `which blocks?` (credentials, oauth, sso, mfa, fga, ...) and writes a working starter `auth.ts` + the matching migrations + an example `signin.html` (or whichever framework)
- Ship as `@absolutejs/create-auth-app` (sibling package — separate to keep the main package lean)
- The existing `@absolutejs/absolute` CLI has the scaffolder primitives; this would be auth-specific templates

**Effort:** ~2-3 days. Half template work, half UX.
**Beats:** Clerk's `npx create-clerk-app` at the friction point.

#### G9. Idle background ops — periodic credential breach re-check + inactive-user cleanup
We ship login-time `checkBreachesOnLogin` (HIBP at sign-in). Auth0 has Credential Guard which re-scans existing user passwords. Consumers can already do this manually via `isPasswordCompromised`, but the canonical setup is a daily cron.

- Ship `runBreachAuditScan({ credentialStore, batchSize, onCompromised })` — a streaming scanner the consumer schedules
- Ship `pruneInactiveUsers({ olderThanDays, dryRun, onDelete })` likewise
- Composes with our existing audit + webhook plumbing so each detection emits a `password_breach_detected` event

**Effort:** ~1 day. Pure orchestration over existing primitives.

### Tier 3 — lower value, sometimes higher effort, mostly defer-or-skip

#### G10. JARM (JWT Secured Authorization Response Mode)
Niche. Returns the authorize-response params (`code`, `state`) inside a signed JWT instead of as query params, to prevent tampering after PAR/JAR closed the request side. FAPI Advanced wants it; nobody outside FAPI cares. Skip until a FAPI consumer asks.

#### G11. OIDC Federation 1.0
For inter-org trust frameworks (the eIDAS pattern again). Almost no production usage outside academic + government PoCs. Defer until VC work (G6) makes it relevant.

#### G12. Identity broker / IDP chaining
Keycloak's pattern of "use IdP A to authenticate to IdP B." We have the primitives (SSO + custom callback hooks) to compose this manually; a turnkey wrapper isn't widely demanded. Skip unless asked.

#### G13. Hosted admin dashboard
Explicit non-goal (drop-in UI). The headless `portal` block + the React/Vue/Solid/Svelte composables are the seam; consumers build their own.

#### G14. Cross-customer reputation network
Explicit non-goal (SaaS data network). The fingerprint-client + adaptive-risk primitives are the algorithm side; a shared reputation feed is fundamentally a SaaS product.

---

## Recommended sprint order

Pack into roughly version-sized cycles. Tier 1 first, ordered by independence (so each release stands alone):

1. **`0.35.0` — Observability + scaffolding**: G1 (OTel) + G2 (migrations + CLI). Both are pure adoption-friction reductions; together they remove the two biggest "we tried it but ops/onboarding pain" objections.
2. **`0.36.0` — Financial-grade auth**: G3 (CIBA) + G4 (mTLS). Both unlock the FAPI 2.0 baseline profile; ship together so a banking/healthcare consumer can adopt in one bump.
3. **`0.37.0` — Passkey ergonomics + background ops**: G5 (passkey autofill/upgrade) + G9 (background scans). Small, ships easily.
4. **`0.38.0` — SCIM polish + scaffolder**: G7 + G8.
5. **`0.40.0` — Verifiable credentials**: G6 alone as a dedicated cycle because it's a new spec family.

Optional: bundle G10/G11 into 0.40 if a consumer asks during VC work.

---

## Explicit non-goals (recorded so they don't come back)

These are the things competitors offer that we are deliberately NOT building. Listing them here so future scouts don't re-litigate.

- **Hosted infrastructure / SaaS data plane** — the entire point of `@absolutejs/auth` is in-house. Operators who want hosted go to WorkOS / Auth0.
- **Drop-in pre-styled UI components** — we ship the primitives (HTMX fragments + framework composables + headless portal). Consumers build the visual layer with their own design system. The HTMX path is the closest we get to "drop-in" because `hx-*` IS the abstraction.
- **Cross-customer reputation network** — fundamentally a SaaS product. We ship the algorithm-side fingerprint + adaptive engine.
- **Hosted plugin marketplace / publishing** — the npm package is the platform. First-party plugins (0.30.0) demonstrate the pattern; consumers publish their own under whatever scope they want.
- **Org-level branding / theming** — UI concern, see drop-in UI above.
- **Hosted SOC 2 audit / FedRAMP / HIPAA BAA** — those are the consumer's compliance posture; we ship the audit-integrity primitive that helps them prove it.

---

## What this doc is NOT

- Not a release plan with dates — those land in `ROADMAP-0.35.md` etc. when work starts on a specific cycle.
- Not a competitor matrix — that's `COMPETITIVE-ANALYSIS.md`. This doc is the forward-looking gap analysis.
- Not a promise — items can be reordered, deferred, or dropped if priorities shift. Especially Tier 3.
