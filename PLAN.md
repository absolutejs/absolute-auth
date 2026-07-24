# @absolutejs/auth — Enterprise Auth Build Plan

Roadmap to take `@absolutejs/auth` from "OAuth2 social login" to a full
enterprise-grade identity layer: **email/password, MFA, SSO (SAML + OIDC), SCIM,
audit, and the rest of the enterprise checklist** — built the AbsoluteJS + Elysia
way, on the grain the package already has.

> Companion: this directly fills gaps **G2/G3** and unblocks tasks **AU1–AU4** in
> `~/onspark/absolutejs/dealroom/MIGRATION_PLAN.md`. onSpark is the first consumer;
> build to its needs, ship to the ecosystem.

Current version: `0.25.1` (stable) / `0.26.0-beta.3` (beta). License CC BY-NC 4.0.

> **WorkOS-parity additions (2026-05-25, post-plan — on `main`, 117 tests green):** beyond the
> original plan, five WorkOS-style feature blocks landed to close the gap with hosted auth
> platforms. All additive/optional, same store + hook + audit conventions.
> - **`organizations`** — first-class tenancy: Organization + membership + email invitations
>   (`src/organizations/`, 3 Postgres tables). Turns the bare `organizationId` into a real model.
> - **`roles`** — org-scoped role definitions + `createMembershipPermissionResolver` that makes
>   the E4 `authorization.hasPermission` hook turnkey from membership roles (`src/roles/`).
> - **`passwordless`** — magic links + email/SMS OTP login (`src/passwordless/`), each mounted
>   only when its send hook is set; both mint the standard session.
> - **`webhooks`** — Standard-Webhooks-signed outbound delivery of every auth event
>   (`src/webhooks/`); configuring it forwards the whole audit taxonomy to your endpoints.
> - **`portal`** — headless WorkOS-style admin setup links (`src/portal/`): a scoped, time-boxed
>   setup token (`createSetupSession`) + JSON endpoints a customer's IT admin calls to read the SP
>   URLs and self-configure their SSO connection / SCIM token. JSON contract = build the portal UI
>   in any of the 6 frameworks (or HTMX); the package ships the backend, not a coupled UI.

> **Build status (2026-05-25):** F1–F4 + **Workstream A (email/password)** + **Workstream B
> (MFA)** + **Workstream E (E1 audit, E2 lockout, E3 session mgmt, E4 RBAC, E5 compliance)** +
> **WebAuthn/passkeys** are DONE on branch `feat/enterprise-auth` — 95 tests green,
> `build`/`typecheck`/`lint` clean. **Workstreams C (SSO) + D (SCIM) + E (hardening) + WebAuthn
> COMPLETE — every headline workstream in this plan is now done.** SSO: OIDC + SAML + discovery +
> full signed SP/IdP-initiated SLO. SCIM: `ScimTokenStore` + `{scimRoute}/Users` + `/Groups` +
> `/ServiceProviderConfig` with per-org bearer auth + mapping hooks, mounted via the `scim` block.
> E4: `protectPermission` derive (delegates to `hasPermission` hook). E5: GDPR export/erasure
> routes + audit PII redaction + AES-GCM field cipher. WebAuthn: register + passwordless
> authenticate ceremonies behind a dependency-light `WebAuthnAdapter` (consumer wraps
> `@simplewebauthn/server`; package never bundles the WebAuthn crypto).
>
> New Postgres tables/migrations since A: nullable `auth_sessions.authenticated_at_ms`;
> new tables `auth_mfa_enrollments`, `auth_audit_events`, `auth_lockouts`,
> `auth_sso_connections`.
>
> **Design defaults:** registration **auto-logs-in** by default (`requireEmailVerification:
> true` switches to verify-first: no session on register, login blocked until verified).
> `SessionData.accessToken` is now **optional** — credential/SSO sessions omit it (only the
> OAuth routes read it). Migration for existing Neon consumers:
> `ALTER TABLE auth_sessions ALTER COLUMN access_token DROP NOT NULL;` plus create the new
> `auth_credentials` / `auth_credential_*_tokens` tables.
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
  caps (extend `sessionCleanup`), absolute + idle timeout config. **Also wire
  password-reset / password-change to revoke all of a user's other sessions** — this
  needs the user→sessions index E3 introduces (today it is delegated to the
  `onPasswordReset` hook; see the TODO in `credentials/passwordReset.ts`).
- ✅ **E4 · Org / tenancy & RBAC hooks** (`src/authorization/`): `protectPermissionPlugin`
  exposes a `protectPermission(check, handler)` derive alongside `protectRoute`/`requireRecentAuth`,
  delegating the role/permission decision to the consumer's `hasPermission({ user, permission,
  organizationId })` hook. 401 when unauthenticated, 403 when denied (denials emit an
  `authorization_denied` audit event). Mounted only when `AuthConfig.authorization` is supplied;
  the package stays schema-agnostic about roles/permissions.
- ✅ **E5 · Compliance helpers** (`src/compliance/`): GDPR/CCPA self-service — `GET
  {complianceRoute=/auth/account}/export` (right to access, returns consumer-gathered JSON) and
  `DELETE {complianceRoute}` (right to erasure — runs `deleteUserData`, revokes every session the
  user holds via `revokeUserSessions`, clears the cookie; emits `data_exported`/`account_deleted`).
  Configurable PII redaction wired into the audit emitter via `AuditConfig.redact` +
  `createAuditRedactor({ dropFields, hashFields, redactIp })` (drop or pseudonymize-by-hash).
  `createSecretCipher(key)` binds the F2 AES-GCM key so stores can encrypt fields at rest.

**Acceptance:** lockout trips and recovers; a user can list and revoke their own
sessions; audit events fire for all flows; `protectPermission` gates a route.

---

## 9. Extended config surface (target shape)

```ts
const auth = await absoluteAuth<User>({
  providersConfiguration: { google: {…}, microsoft: {…} },   // existing OAuth
  authSessionStore: createNeonAuthSessionStore(dbUrl, decodeUser),

  credentials: { credentialStore, passwordPolicy, getUserByEmail,
                 onCreateCredentialUser, onSendEmail, onCredentialsLoginSuccess },
  mfa:         { mfaStore, factors: ['totp','backup_codes'], onSendOtp },
  sso:         { ssoConnectionStore, samlAdapter, getOrganizationByEmailDomain,
                 onSsoCallbackSuccess },
  scim:        { scimTokenStore, onScimUserCreate, onScimUserDeactivate },
  audit:       { auditStore, redact: createAuditRedactor({ hashFields: ['email'] }) },
  lockout:     { maxAttempts, window, backoff },
  authorization: { hasPermission },                          // E4 — RBAC, schema-agnostic
  compliance:  { exportUserData, deleteUserData, getUserId }, // E5 — GDPR access/erasure
  webauthn:    { webauthnAdapter, credentialStore, rpId, rpName, origin,
                 getUserId, getWebAuthnUser },                // passkeys (passwordless)
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
3. ✅ **Workstream B — MFA (TOTP + backup codes)** → unblocks onSpark `AU3` / backlog P34 — DONE.
   - ✅ B1 `promoteToSession` moved to shared `src/session/promote.ts`.
   - ✅ B2 `MFAStore` (in-memory + Postgres) — encrypted TOTP secret, hashed backup codes.
   - ✅ B3 TOTP enroll (`/auth/mfa/totp/setup`+`/verify`) + single-use backup codes.
   - ✅ B4 `/auth/mfa/challenge` promotes the parked session; `createMfaGate` auto-wired
     into `credentials.isMfaRequired` by `auth()`; full enroll→login→challenge test.
   - ✅ B5 step-up: `authenticatedAt` on `SessionData` + `stepUpPlugin` (`requireRecentAuth`).
4. ✅ **Workstream E — enterprise hardening** — DONE (E1 = SOC 2 prereq).
   - ✅ E1 audit: `AuditSink` (in-memory + Postgres), `AuditConfig`, `createAuditEmitter`,
     `compose*Audit` wrappers; `auth()` emits register/login/mfa/logout/etc. events.
   - ✅ E2 lockout: `LockoutStore` (in-memory + Postgres) + `createLockoutGuard`
     (per-identity progressive lockout); credential login returns 429 once locked.
     (per-IP keying is supported by the store; login keys by email today.)
   - ✅ E3 sessions: `GET /auth/sessions` + `DELETE /auth/sessions/:id` (own sessions),
     `listUserSessions`/`revokeUserSessions` helpers (the latter for password-reset
     revocation via the `onPasswordReset` hook). TODO: device/UA/IP metadata + idle timeout.
   - ✅ E4 RBAC: `protectPermissionPlugin` → `protectPermission(check, handler)` derive,
     delegating to the consumer's `hasPermission` hook; 401/403 + `authorization_denied` audit.
   - ✅ E5 compliance: GDPR export/erasure routes (`/auth/account/export` + `DELETE
     /auth/account`), `AuditConfig.redact` + `createAuditRedactor` PII redaction, `createSecretCipher`
     (F2 AES-GCM field encryption at rest). 10 tests (authorization.test.ts + compliance.test.ts).
5. **Workstream C — SSO (OIDC first, then SAML)** → the headline enterprise sale.
   - ✅ C1 `SSOConnectionStore` (in-memory + Postgres + Neon) — per-org OIDC/SAML config
     keyed by `organizationId` (`auth_sso_connections`, type-specific config in a jsonb
     column); enabled-only resolution for sign-in + full list for admin. 6 tests.
   - ✅ C2 enterprise OIDC: extended **citra** (`createOIDCClient` + in-house JWKS verify,
     RS256/ES256 via WebCrypto, published **citra 0.28.0**); `src/sso/oidcRoutes.ts` mounts
     `GET {ssoRoute}/oidc/:organizationId/authorize` + `.../callback` (discovery + PKCE S256 +
     id_token verify + `promoteToSession`); `SSOConfig` (`getSsoUser` hook) wired into `auth()`.
     OidcConnectionConfig gained `redirectUri`. citra: 7 verify tests; auth: 2 route tests.
   - ✅ C3 SAML 2.0: dependency-light `SamlAdapter` contract (consumer wraps a vetted lib like
     `@node-saml/node-saml`; the package never bundles the XML-DSig footgun); `src/sso/samlRoutes.ts`
     mounts `GET .../saml/:org/authorize` (→ IdP), `POST .../saml/:org/acs` (validate assertion →
     `promoteToSession`), `GET .../saml/:org/metadata` (SP metadata). `SsoIdentity` is now an
     OIDC|SAML discriminated union (`protocol`). Mounts only when `sso.samlAdapter` supplied.
     4 route tests (fake adapter). C4 wiring done for both protocols.
   - ✅ Closed out C: home-realm discovery (`getOrganizationByEmailDomain` →
     `GET {ssoRoute}/authorize?email=`) and a full IdP-mocked OIDC authorize→callback E2E
     (signed id_token verified against a mock JWKS). **Workstream C COMPLETE.**
   - ✅ Full robust SAML Single Logout (replaces the earlier best-effort redirect). The ACS now
     stashes `samlLogout` (connectionId + NameID + SessionIndex) on the session via
     `promoteToSession`. `GET .../saml/:org/logout` reads that context, clears the local session,
     then asks the adapter to build a **signed LogoutRequest** (NameID + SessionIndex) and
     redirects to the IdP SLO endpoint — falling back to a plain redirect only when the adapter or
     connection can't sign. New `GET .../saml/:org/slo` front-channel endpoint handles both the
     IdP's `SAMLResponse` (completing SP-initiated logout) and IdP-initiated `SAMLRequest`
     (validate → `clearSession` → signed `LogoutResponse` back). `SamlAdapter` gains four optional
     SLO methods (`createLogoutRequestUrl`, `createLogoutResponseUrl`, `validateLogoutRequest`,
     `validateLogoutResponse`); all stay dependency-light (consumer's vetted XML-DSig lib). 3 SLO
     route tests (fake adapter): SP-initiated signed request, LogoutResponse completion,
     IdP-initiated request. Open-redirect-safe RelayState (local paths only).
6. **Workstream D — SCIM** → follows SSO (same per-org connection model).
   - ✅ D1 `ScimTokenStore` (in-memory + Postgres + Neon, `auth_scim_tokens`) — per-org bearer
     tokens, hashed; `createScimToken` (plaintext once) + `resolveScimOrganization` (bearer→org).
   - ✅ D2 SCIM 2.0 Users: `{scimRoute=/scim/v2}/ServiceProviderConfig` + `/Users`
     (POST/GET-list+filter/GET:id/PUT/PATCH/DELETE), in-house serialize/parse + PatchOp merge,
     per-org bearer auth, `application/scim+json` parsing. Mapping hooks (getScimUser,
     listScimUsers, onScimUserCreate/Replace/Deactivate).
   - ✅ D3 wired into `auth()` via the `scim` block; exports; 4 tests (token store + full
     create→list→get→patch-deactivate→delete round-trip + 401).
   - ✅ D4 SCIM Groups: `{scimRoute}/Groups` (POST/GET-list/GET:id/PUT/PATCH/DELETE), PatchOp
     member add/remove (incl. `members[value eq "id"]`) + displayName; optional group hooks
     (getScimGroup, listScimGroups, onScimGroupCreate/Replace/Delete) — routes 501 when omitted.
     (`ScimUserFilter` generalized to `ScimFilter`, shared by Users + Groups). **Workstream D COMPLETE.**
7. ✅ **Workstream E4/E5** — RBAC hooks + compliance helpers DONE (see Workstream E above).
8. ✅ **WebAuthn / passkeys** (`src/webauthn/`) — DONE. Dependency-light `WebAuthnAdapter` (consumer
   wraps `@simplewebauthn/server`; the package never bundles the CBOR/COSE/attestation footgun —
   same pattern as `SamlAdapter`/`RedisLike`). Routes: `{webauthnRoute=/auth/webauthn}/register/
   options` + `/register/verify` (add a passkey to the authenticated caller, `excludeCredentials`
   from the user's existing keys), `.../authenticate/options` + `/authenticate/verify` (passwordless
   discoverable-credential sign-in → `promoteToSession`, mints the same `SessionData<UserType>`).
   Short-lived single-use `webauthn_challenge` cookie binds options→verify (open-redirect-free,
   no challenge store needed). `WebAuthnCredentialStore` (in-memory + Postgres + Neon,
   `auth_webauthn_credentials`, PK credential_id, list-by-user); signature counter persisted +
   bumped each assertion. Audit: `webauthn_registered` / `webauthn_authenticated`. Mounted via the
   optional `webauthn` block. 5 tests (fake adapter). **All headline workstreams complete.**

   Possible future polish (not in this plan): passwordless *signup* (create-user-on-first-passkey),
   per-user passkey list/delete management route, conditional-UI / allowCredentials hints.

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
- **SAML dep:** ✅ resolved in Workstream C. `@node-saml/node-saml` (or any vetted XML-DSig lib)
  behind the `SamlAdapter` — the package never bundles it.
- **WebAuthn:** ✅ resolved. `@simplewebauthn/server` behind the `WebAuthnAdapter` — the package
  never bundles it; the consumer pins their own version (the lib churns hard across majors).

> Principle that drove the above: **do it in-house with Bun + WebCrypto + Elysia**
> (passwords, TOTP, tokens, AES-GCM, JWKS, SCIM, audit, lockout). A bundled dependency is
> reserved for the two primitives where hand-rolling is genuinely dangerous — SAML
> signature validation and WebAuthn attestation — each isolated behind an adapter.
