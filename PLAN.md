# @absolutejs/auth — Enterprise Auth Build Plan

Roadmap to take `@absolutejs/auth` from "OAuth2 social login" to a full
enterprise-grade identity layer: **email/password, MFA, SSO (SAML + OIDC), SCIM,
audit, and the rest of the enterprise checklist** — built the AbsoluteJS + Elysia
way, on the grain the package already has.

> Companion: this directly fills gaps **G2/G3** and unblocks tasks **AU1–AU4** in
> `~/onspark/absolutejs/dealroom/MIGRATION_PLAN.md`. onSpark is the first consumer;
> build to its needs, ship to the ecosystem.

Current version: `0.25.1`. License CC BY-NC 4.0.

> **Build status (2026-05-24):** F1–F4 foundations + **Workstream A (email/password) are
> DONE** on branch `feat/enterprise-auth` — 33 tests green, `build`/`typecheck`/`lint` clean.
> Next up: Workstream B (MFA). See §11 for the live checklist.
>
> **Layout note:** `src/` is now organized into **feature folders** (`routes/`, `session/`,
> `credentials/`, `stores/`, …), not flat. The composed entry function is `auth<UserType>()`
> in `src/index.ts`. New families get their own folder (`src/mfa/`, `src/sso/`, …).

---

## 1. The grain to respect (non-negotiable conventions)

Every new feature MUST follow the patterns already in `src/`:

- **One responsibility per file, in feature folders.** `src/` is organized into folders
  (`routes/`, `session/`, `credentials/`, `stores/`, …); new families get their own folder
  (`src/mfa/`, `src/sso/`, `src/scim/`, `src/audit/`). Named exports only — no default exports.
- **A feature is a generic function returning an Elysia instance**, mounted via
  `.use()` inside `absoluteAuth<UserType>()` in `src/index.ts`, **before**
  `protectRoutePlugin`. Reuse `.use(sessionStore<UserType>())` for state.
- **`<UserType>` generic everywhere. The consumer owns the user table.** The package
  never assumes a user schema — it asks via hooks (`getUser`, `onNewUser`, new
  equivalents) and persists only through pluggable stores.
- **Stores are interfaces with two implementations**, exactly like
  `AbsoluteAuthSessionStore` → `createInMemoryAuthSessionStore` +
  `createNeonAuthSessionStore`. Every new persistence need ships
  `createInMemoryXStore` (dev/test) and `createNeonXStore` (Drizzle/Neon).
- **Hooks over hard-coded logic.** Each flow exposes `onXxxSuccess` / `onXxxError`
  that can return `void | Response | status()` for early exits. Match the existing
  `OnCallbackSuccess` shape.
- **Elysia-idiomatic only:** `.use()` composition, `t.Cookie`/typebox validation
  (`src/typebox.ts`), `.guard()` + `.derive()` (no custom decorators/classes).
  httpOnly + Secure + Lax cookies via the existing `COOKIE_DURATION` pattern.
- **Reuse citra** for anything OAuth/OIDC/crypto: `createOAuth2Client`,
  `generateState`, `generateCodeVerifier`, `createS256CodeChallenge`, `decodeJWT`,
  `normalizeProviderIdentity`, and the provider type guards. Don't reinvent these.
- **Bun-first, dependency-light.** Prefer Bun/WebCrypto built-ins (see Foundations).
  An external dep is only justified where the primitive is genuinely hard (XML DSig
  for SAML, WebAuthn attestation) — and must be isolated behind an adapter.
- **Types in `types.ts`, guards in `typeGuards.ts`, schemas in `typebox.ts`,
  constants in `constants.ts`, errors in `errors.ts`.** Branded types (`UserSessionId`)
  for ids. Strict TS.

---

## 2. Current state (what we build on)

Already present and reusable:
- OAuth2/OIDC login: `authorize` → `callback` → `refresh`/`revoke` → `signout`,
  `userStatus`, `profile`, all generic over `UserType`, via citra.
- Session abstraction: `AbsoluteAuthSessionStore<UserType>` (get/set/remove +
  unregistered variants + optional `listSessionIds`), in-memory + Neon impls.
- **`UnregisteredSessionData`** — the pre-auth/half-authenticated state record. This
  is the existing primitive we reuse for **MFA challenges and SSO assertions**.
- `protectRoutePlugin` (global guard + `protectRoute(user => …)` derive),
  `sessionCleanup` (interval expiry + max-session enforcement).
- linked-providers grant/binding stores + credential resolver (reused for SCIM token
  storage and connector grants).
- citra crypto + provider type guards re-exported from `index.ts`.

Not present (this plan): local email/password, MFA, SAML/enterprise-OIDC SSO, SCIM,
audit logging, rate limiting/lockout, organizations/tenancy, password reset/email
verification, session listing/remote revoke, federated logout, WebAuthn.

---

## 3. Foundations (do first — everything depends on these)

**F1 · Test runner.** `test` is currently a stub (`exit 1`). Wire **`bun test`**,
add `tests/` with `setup.ts`. Auth is security-critical — every workstream below ships
with tests. This is a prerequisite, not optional.

**F2 · Crypto/security primitives** (`src/crypto.ts`, no external deps):
- Password hashing via **`Bun.password.hash` / `Bun.password.verify`** (argon2id by
  default) — the Bun-native way, zero dependencies.
- Constant-time token compare; secure random token generator (reuse citra's
  `generateState` style) for email-verify / reset / invite tokens.
- TOTP (RFC 6238) and HOTP via **WebCrypto HMAC-SHA1** — implement in-house, no dep.
- Token-encryption helper (AES-GCM via WebCrypto) for encrypting provider tokens /
  TOTP secrets at rest in stores.

**F3 · Tenancy primitive** (`src/tenancy.ts`): an optional `organizationId` threaded
through `SessionData`, SSO connections, SCIM tokens, and audit events. Keep it a
plain identifier — the package stays unopinionated about org/role schemas (consumer
owns them via hooks). Required so SSO/SCIM can be configured **per organization**.

**F4 · Store pattern scaffolding** (`src/enterpriseStores.ts` or per-feature files):
the new store interfaces (below), each with `createInMemory…` + `createNeon…`,
matching `neonAuthSessionStore.ts` Drizzle conventions.

---

## 4. Workstream A — Email / Password (credentials)

Fills **G2**. The most-needed piece; unblocks onSpark `AU2`.

**Goal:** first-class local credentials that coexist with OAuth sessions and produce
the same `SessionData<UserType>`, transparent to `protectRoute`.

**New files:**
- `src/credentialsRegister.ts` — `POST /auth/register` `{ email, password }`: validate
  policy → `Bun.password.hash` → consumer `onCreateCredentialUser(identity)` → issue
  unregistered/registered session → trigger email verification.
- `src/credentialsLogin.ts` — `POST /auth/login` `{ email, password }`: consumer
  `getUserByEmail` → `Bun.password.verify` → lockout check (Workstream E) → if MFA
  enrolled, create **unregisteredSession** and return a `mfa_required` status; else
  promote to session.
- `src/emailVerification.ts` — request + confirm (`/auth/verify-email`), token via F2,
  stored in `CredentialStore`, delivered through an `onSendEmail` hook (consumer owns
  the transport — Resend, SES, etc.; package never sends mail directly).
- `src/passwordReset.ts` — request + confirm (`/auth/reset-password`), single-use
  expiring token, invalidates other sessions on success.
- `src/passwordPolicy.ts` — configurable min length/complexity + optional HaveIBeenPwned
  k-anonymity breach check (WebCrypto SHA-1 range query, no dep, no plaintext leaves).
- `src/magicLink.ts` *(optional, passwordless)* — reuses the verification-token infra
  for email-link sign-in.
- `src/credentialStores.ts` + `src/neonCredentialStore.ts` — **`CredentialStore`**:
  `getCredentialByEmail`, `saveCredential` (hash, status), `setEmailVerified`,
  `saveVerificationToken`/`consumeVerificationToken`, `saveResetToken`/`consumeResetToken`.

**Config additions** (`AbsoluteAuthProps.credentials?`): `credentialStore`,
`passwordPolicy`, hooks `getUserByEmail`, `onCreateCredentialUser`, `onSendEmail`,
`onCredentialsLoginSuccess/Error`, `onRegistrationSuccess`, `onEmailVerified`,
`onPasswordReset`. Routes overridable like existing `RouteString` props.

**Reuse:** `SessionData`/`UnregisteredSessionData`, session store, cookie helpers,
typebox for body validation. **Acceptance:** register→verify→login→reset round-trips
with tests; sessions interchangeable with OAuth sessions under `protectRoute`; no
plaintext password or token ever stored.

---

## 5. Workstream B — MFA / second factor

Fills **G3**. Unblocks onSpark `AU3` (backlog P34).

**Goal:** pluggable second factors gating session promotion, modeled as a challenge
state machine over the existing `UnregisteredSessionData`.

**New files:**
- `src/mfaTotp.ts` — `POST /auth/mfa/totp/setup` (generate secret via F2, return
  otpauth URI for QR), `…/verify` (confirm enrollment).
- `src/mfaChallenge.ts` — the gate: after primary auth (credentials **or** OAuth
  callback), if the user has factors, **keep the unregisteredSession** and return
  `mfa_required`; `POST /auth/mfa/challenge` `{ code }` validates and **promotes
  unregistered → registered session**. This mirrors the OAuth callback mid-flow
  exactly — no new session concept needed.
- `src/mfaBackupCodes.ts` — generate/consume single-use recovery codes (hashed via F2).
- `src/mfaOtpDelivery.ts` *(SMS/email OTP)* — delivery via consumer `onSendOtp` hook
  (SMS provider is the consumer's; see onSpark gap G4).
- `src/mfaWebAuthn.ts` *(passkeys, later phase)* — registration/assertion. The one
  place a vetted dep (`@simplewebauthn/server`) is justified; isolate behind an adapter.
- `src/stepUp.ts` — re-auth for sensitive actions: a `requireRecentAuth(maxAgeMs)`
  derive usable alongside `protectRoute`.
- `src/mfaStores.ts` + `src/neonMfaStore.ts` — **`MFAStore`**: enrolled factors,
  encrypted secrets (F2), backup codes, last-used timestamps.

**Config additions** (`AbsoluteAuthProps.mfa?`): `mfaStore`, enabled factors,
`onSendOtp`, `onMfaEnrolled`, `onMfaChallengeSuccess/Error`, issuer label for TOTP.

**Reuse:** unregisteredSession as the challenge carrier; F2 crypto. **Acceptance:**
TOTP enroll + challenge + backup-code fallback with tests; OAuth and credentials logins
both correctly gated; step-up blocks a marked route until recent re-auth.

---

## 6. Workstream C — SSO (SAML 2.0 + enterprise OIDC)

The core enterprise ask. Per-organization IdP configuration (the WorkOS-style model).

**Goal:** an org's IT can connect their IdP; users sign in via SAML or OIDC; identity
maps into the same `onCallbackSuccess` / user-resolution flow.

**New files:**
- `src/ssoConnectionStores.ts` + `src/neonSsoConnectionStore.ts` —
  **`SSOConnectionStore`** keyed by `organizationId` + connection type: SAML (IdP
  metadata/entityID/x509 cert/ACS) or OIDC (issuer/discovery URL/client creds).
- `src/oidcEnterprise.ts` — generic OIDC via **discovery document** + JWKS. Extend
  citra with a runtime-configured OIDC provider (issuer → endpoints) rather than a
  compile-time provider; verify `id_token` against JWKS (WebCrypto or `jose`). Reuses
  citra's `decodeJWT` / `normalizeProviderIdentity`.
- `src/samlAuthorize.ts` / `src/samlCallback.ts` — `GET /sso/saml/:org/authorize`
  (build AuthnRequest, redirect to IdP), `POST /sso/saml/:org/acs` (parse + validate
  signed assertion, extract identity). **XML DSig validation requires a vetted dep**
  (`@node-saml/node-saml`); wrap it behind a `SamlAdapter` so the core stays clean.
- `src/samlMetadata.ts` — serve SP metadata per org (`/sso/saml/:org/metadata`).
- `src/sloLogout.ts` — Single Logout (SAML SLO) + RP-initiated OIDC logout (federated
  logout — currently missing entirely).

**Config additions** (`AbsoluteAuthProps.sso?`): `ssoConnectionStore`, `samlAdapter`,
`onSsoCallbackSuccess` (receives normalized identity + `organizationId`, same contract
as `onCallbackSuccess`), domain→org routing (`getOrganizationByEmailDomain`).

**Reuse:** identity-conflict handling (`AbsoluteAuthIdentityConflictError`,
`onLinkIdentityConflict`), unregisteredSession, session store, the existing
callback→user-resolution path. **Acceptance:** SP-initiated + IdP-initiated SAML and
an OIDC connection both create valid sessions against a test IdP (e.g. mock/SAML
fixtures); SP metadata validates; SLO clears the session.

---

## 7. Workstream D — SCIM 2.0 provisioning

So enterprise IT directories auto-provision/deprovision users.

**New files:**
- `src/scimRoutes.ts` — SCIM 2.0 endpoints (`/scim/v2/Users`, `/scim/v2/Groups`,
  `ServiceProviderConfig`), per-connection **bearer token** auth. Pure REST + JSON
  schema, implement in-house (no dep).
- `src/scimMapping.ts` — map SCIM User/Group resources to the consumer's user store
  via hooks (`onScimUserCreate/Update/Deactivate`, `onScimGroupSync`).
- `src/scimStores.ts` + `src/neonScimStore.ts` — **`ScimTokenStore`** (per-org bearer
  tokens, scoped, revocable). Can reuse linked-providers grant store shape.

**Config additions** (`AbsoluteAuthProps.scim?`): `scimTokenStore`, the mapping hooks,
`organizationId` scoping. **Acceptance:** Okta/Azure-AD-style provisioning create →
update → deactivate round-trips against SCIM compliance test vectors.

---

## 8. Workstream E — Enterprise hardening

The "anything else enterprise expects" tail. Each is small and orthogonal.

- **E1 · Audit logging** (`src/audit.ts` + `src/neonAuditStore.ts`): an **`AuditSink`**
  (in-memory + Neon), plus a wrapper that emits structured, append-only events
  (`login`, `logout`, `register`, `mfa_enrolled`, `mfa_challenge`, `password_reset`,
  `sso_login`, `scim_provision`, `token_revoked`, `identity_conflict`, …) from every
  lifecycle hook. Exportable; SOC 2 prerequisite. Consumer can also pass `onAuditEvent`.
- **E2 · Rate limiting & account lockout** (`src/lockout.ts`): per-identity + per-IP
  attempt counters in a store; progressive backoff + lockout; integrates
  `elysia-rate-limit` (already in the ecosystem) for transport-level limits.
- **E3 · Session management UX** (`src/sessions.ts`): `GET /auth/sessions` (list active
  — needs the store's optional `listSessionIds`, add device/UA/IP metadata to
  `SessionData`), `DELETE /auth/sessions/:id` (remote revoke), concurrent-session
  caps (extend `sessionCleanup`), absolute + idle timeout config.
- **E4 · Org / tenancy & RBAC hooks** (`src/authorization.ts`): build on F3; add a
  `protectPermission(check)` derive alongside `protectRoute`, delegating the actual
  role/permission decision to a consumer hook (`hasPermission(user, perm, orgId)`).
  Package stays schema-agnostic.
- **E5 · Compliance helpers** (`src/compliance.ts`): GDPR data export/delete hooks,
  token/secret encryption-at-rest (F2 AES-GCM) wired into every store, configurable
  PII redaction in audit events.

**Acceptance:** lockout trips and recovers; a user can list and revoke their own
sessions; audit events fire for all flows; `protectPermission` gates a route.

---

## 9. Extended config surface (target shape)

```ts
const auth = await absoluteAuth<User>({
  providersConfiguration: { google: {…}, microsoft: {…} },   // existing OAuth
  authSessionStore: createNeonAuthSessionStore<User>(dbUrl),

  credentials: { credentialStore, passwordPolicy, getUserByEmail,
                 onCreateCredentialUser, onSendEmail, onCredentialsLoginSuccess },
  mfa:         { mfaStore, factors: ['totp','backup_codes'], onSendOtp },
  sso:         { ssoConnectionStore, samlAdapter, getOrganizationByEmailDomain,
                 onSsoCallbackSuccess },
  scim:        { scimTokenStore, onScimUserCreate, onScimUserDeactivate },
  audit:       { auditStore },                                // or onAuditEvent
  lockout:     { maxAttempts, window, backoff },
});
```
Every block is optional; existing OAuth-only consumers are unaffected (additive, no
breaking changes). Each block ships its in-memory store for zero-config dev.

## 10. New store abstractions (all: in-memory + Neon)

| Store | Holds | Workstream |
| --- | --- | --- |
| `CredentialStore` | password hashes, verify/reset tokens, email-verified | A |
| `MFAStore` | enrolled factors, encrypted secrets, backup codes | B |
| `SSOConnectionStore` | per-org SAML/OIDC IdP config | C |
| `ScimTokenStore` | per-org SCIM bearer tokens | D |
| `AuditSink` | append-only auth events | E1 |
| `LockoutStore` | attempt counters, lock state | E2 |

## 11. Sequencing (and onSpark unblocks)

1. ✅ **F1–F4 foundations** (test runner + crypto + tenancy + store scaffolding) — DONE.
   - ✅ F1 `bun test` + `tsconfig.eslint.json`; tooling on the `absolute` CLI.
   - ✅ F2 `src/crypto.ts` (password/tokens/TOTP/AES-GCM; RFC 6238 vectors verified).
   - ✅ F3 `src/tenancy.ts` (`OrganizationId` + `WithOrganization`).
   - ✅ F4 `src/stores/postgres.ts` (`AnyPgDatabase` + `createNeonDatabase`).
2. ✅ **Workstream A — email/password** → unblocks onSpark `AU2` + backlog P33/P40 — DONE.
   - ✅ `CredentialStore` (in-memory + Postgres), `passwordPolicy.ts` (+ HIBP).
   - ✅ `register` + `emailVerification` routes (+ `credentials/config.ts` surface).
   - ✅ `login` (MFA seam) + `passwordReset` routes.
   - ✅ Wired `credentials` into `auth()`, exports, full round-trip + `protectRoute` test.
3. **Workstream B — MFA (TOTP + backup codes)** → unblocks onSpark `AU3` / backlog P34.
4. **Workstream E1/E2/E3 — audit, lockout, session mgmt** (cheap, high enterprise
   signal; E1 is a SOC 2 prerequisite).
5. **Workstream C — SSO (OIDC first, then SAML)** → the headline enterprise sale.
6. **Workstream D — SCIM** → follows SSO (same per-org connection model).
7. **Workstream E4/E5 + WebAuthn** — RBAC hooks, compliance, passkeys.

Start at **F1 → Workstream A** to make immediate progress in parallel with the onSpark
voice work; A is also the highest-leverage piece for the dealroom auth migration.

## 12. Decisions (resolved 2026-05-24)

- **Drizzle dialect:** ✅ each new store ships in-memory + ONE generic Drizzle-Postgres
  impl that accepts an `AnyPgDatabase` (`PgDatabase<PgQueryResultHKT>`) — runs on Neon AND
  node-postgres, no second driver bundled. `createNeon<X>Store(url)` is a convenience
  wrapper. SQLite deferred unless a consumer needs it.
- **First-party email/SMS transport:** ✅ hook-only (`onSendEmail` / `onSendOtp`). The
  package bundles no transport and stays agnostic; consumer brings Resend/SES/Twilio.
- **JWKS verify:** ✅ in-house via WebCrypto (`crypto.subtle` RS256/ES256). No `jose`.
- **OIDC enterprise:** ✅ extend `citra` with a runtime/discovery-configured provider so
  all OAuth/OIDC lives there (Workstream C).
- **SAML dep:** ⏳ deferred to Workstream C. Lean: `@node-saml/node-saml` behind a
  `SamlAdapter` (hand-rolling XML DSig is a security footgun) — confirm when we start C.
- **WebAuthn:** ⏳ deferred to late phase. Lean: `@simplewebauthn/server` behind an
  adapter — confirm when we start it.

> Principle that drove the above: **do it in-house with Bun + WebCrypto + Elysia**
> (passwords, TOTP, tokens, AES-GCM, JWKS, SCIM, audit, lockout). A bundled dependency is
> reserved for the two primitives where hand-rolling is genuinely dangerous — SAML
> signature validation and WebAuthn attestation — each isolated behind an adapter.
