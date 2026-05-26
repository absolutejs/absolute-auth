# Roadmap — `@absolutejs/auth` 0.30.0

**Status:** planning, started 2026-05-26. Builds on stable `0.29.3`. After 0.29.x closed every OAuth2/OIDC spec gap relative to WorkOS Connect / Auth0 / Keycloak, this cycle closes the last specific items that consumers can point to as missing:

- A handful of small spec items most don't notice but full-OIDC-conformant deployments need
- One bigger spec item (SAML 2.0 IdP role) for legacy-SaaS interop
- Two pieces ("federated token vault", "bulk user import") that competitors have as concrete features
- Stronger client-side **device fingerprinting** (the algorithm side — not the SaaS data network)
- **First-party plugins** package using the existing `createActionPipeline` primitive (the library side of "marketplace" — not the hosted publishing platform)

Every item below is additive. Existing 0.29.x consumers continue to work unchanged; every new field / endpoint / store is opt-in via config wiring.

---

## Phase A — Package (8 grouped betas → 1 stable)

### A1. `0.30.0-beta.0` — OIDC `/userinfo` + `prompt`/`max_age`/`id_token_hint` re-auth

**Why:** real OIDC conformance gap. RPs send `prompt=none` for silent renew, `prompt=login` to force a fresh sign-in, `max_age=N` to require re-auth after N seconds. Right now we ignore all of them. Plus a UserInfo endpoint is in every OIDC certification matrix.

- `GET /oauth2/userinfo` (and `POST` per spec): Bearer access token → returns the same claims that went into the id_token. Validates JWT + checks scope, returns 401 with `WWW-Authenticate: Bearer` on failure.
- `/authorize` honors `prompt`:
  - `prompt=none` + no session → redirect with `error=login_required` (don't show login page)
  - `prompt=none` + session but ACR insufficient → `error=interaction_required`
  - `prompt=login` → force re-auth (redirect to `loginUrl` even when a session exists)
  - `prompt=consent` → reserved for a future consent screen; for now treated as `none`+`login`
- `/authorize` honors `max_age`: if `session.authenticatedAt < now - max_age*1000` → force re-auth like `prompt=login`
- `/authorize` honors `id_token_hint`: when present + decodes to a different user than the current session, force re-auth
- Discovery: `userinfo_endpoint`
- **Files**: new `src/oidc/userinfo.ts`, extend `src/oidc/routes.ts` (authorize handler), add to discovery
- **Tests**: userinfo happy path, expired-token rejection, wrong-scope rejection; `prompt=none` no-session redirect, `prompt=login` re-auth redirect, `max_age` expiry, `id_token_hint` user-mismatch

**Effort:** half-stretch.

### A2. `0.30.0-beta.1` — RFC 9101 JAR (signed authorize requests)

**Why:** cousin of PAR. Required by FAPI Advanced. The RP can either POST to `/par` (already shipped 0.29.0-beta.4) OR sign the request as a JWT and pass it as `request=<jwt>` on `/authorize`. Some banking RPs only support JAR, not PAR.

- `/authorize` accepts `request=<jwt>` (or `request_uri` pointing at a JWT)
- JWT signed by the client's registered key (reuses the `private_key_jwt` JWKS infrastructure shipped 0.29.0-beta.2)
- All other authorize params (`scope`, `response_type`, etc.) must come from the JWT, not query params
- `OAuthClient.requireSignedRequestObject?: boolean` — FAPI hardening flag
- Discovery: `request_parameter_supported: true`, `request_object_signing_alg_values_supported: ['ES256']`, `require_signed_request_object_supported: true`
- **Files**: extend `src/oidc/par.ts` + the authorize handler
- **Tests**: round-trip JAR → authorize → token, sig validation, wrong-client-key rejection, mixed query+JAR (spec-required to ignore query when JAR present), per-client require flag

**Effort:** 1 stretch.

### A3. `0.30.0-beta.2` — Bulk user import helpers

**Why:** the #1 adoption blocker for customers migrating off Auth0/WorkOS — they have hundreds-of-thousands of users in another system. We ship the primitive of "have a user record"; what's missing is helpers to bulk-load them with their existing password hashes (so users don't have to reset).

- `importUsers({ users, credentialStore, rehasher? })`: streams or batches a user list, calls a consumer `onCreateUser` hook for each, optionally wraps existing password hashes
- **Password rehash adapters** for the common shapes:
  - `auth0PBKDF2Rehasher` — wrap an Auth0-exported `password_hash` so we treat it as a "needs rehash on next login" record
  - `bcryptRehasher` (most common)
  - `argon2Rehasher` (already our native)
  - `cognitoSHA256Rehasher`
- On next login, if the credential is wrapped, verify against the legacy hash → if valid, re-hash with our native Argon2id + replace
- Bulk-import CLI helper: `bun x @absolutejs/auth import --from auth0 --file users.json --db $DATABASE_URL`
- **Files**: new `src/credentials/import.ts` + `src/credentials/legacyHashers.ts` + a small `bin/import-users.ts` CLI
- **Tests**: import + login round-trip (legacy hash → verify → rehash), each adapter, malformed input rejection

**Effort:** 1 stretch.

### A4. `0.30.0-beta.3` — Federated identity token vault

**Why:** Auth0's "Token Vault" — the user signs in with Google, the app needs to call Gmail/Calendar APIs on their behalf. The package's existing `vault` block (beta.11) stores arbitrary encrypted blobs; this is the user-facing OAuth-token-storage flow on top.

- `createFederatedTokenStore({ vault })`: typed wrapper over `createVault` that stores `{ userId, provider, accessToken, refreshToken, expiresAt, scopes }` per (userId, provider)
- `saveFederatedTokens(...)`: called from `onCallbackSuccess` to capture provider tokens
- `getFederatedTokens(userId, provider)`: returns the stored tokens, auto-refreshes if expired AND refresh_token is present AND the provider supports refresh (uses citra)
- `revokeFederatedTokens(userId, provider)`: drops the stored tokens + revokes upstream via provider config
- **Files**: new `src/federation/tokenStore.ts`
- **Tests**: save → get round-trip, auto-refresh on expired access token, revoke clears + calls upstream, per-provider isolation

**Effort:** 1 stretch.

### A5. `0.30.0-beta.4` — Strong client-side device fingerprinting

**Why:** our current `fingerprintDevice(signals)` hashes UA + accept-language + IP — trivially varies under attack. Real device fingerprints come from client-side signals (canvas render, audio context, WebGL renderer, fonts, screen size, timezone, language). Self-hosted, no data network — the algorithm is open knowledge.

- New entry point `@absolutejs/auth/fingerprint-client` (browser bundle): `collectDeviceFingerprint()` returns `{ deviceId, signals }` based on:
  - Canvas rendering hash (draw text + shapes, hash the result)
  - AudioContext fingerprint
  - WebGL renderer + vendor strings
  - Font enumeration (test ~20 popular fonts)
  - Screen geometry + colorDepth + pixelRatio
  - Navigator.languages
  - Timezone + DateTimeFormat
- Server-side: existing `fingerprintDevice` accepts the new `clientFingerprint` field, weighted higher than the weak fallback
- Stable hash: SHA-256 over canonical JSON of the signals
- Frontend SDK (in `createAuthClient`): `client.fingerprintDevice()` returns the same object, attach to login requests as `x-client-fingerprint`
- **Files**: new `src/fingerprint-client/index.ts` (client-only bundle), extend `src/adaptive/fingerprint.ts`, extend `src/client/createAuthClient.ts`
- **Tests**: deterministic hash on same browser, different hash across browsers (deferred to manual + Playwright), graceful fallback when canvas/audio blocked

**Effort:** 1.5 stretches.

### A6. `0.30.0-beta.5` — First-party plugins package

**Why:** the "marketplace" question, library-side. We have `createActionPipeline` (beta.11) as the primitive. Most consumers don't write their own — they want pre-baked patterns. Ship a separate `@absolutejs/auth-plugins` package with the most-asked-for plugins.

- New separate npm package `@absolutejs/auth-plugins` (in this repo as `packages/plugins/` OR a sibling repo)
- First-party plugins (each ~20-50 LOC):
  - `slackAlertPlugin({ webhookUrl, events: [...] })` — POST to Slack webhook on chosen audit events
  - `denyDisposableEmailPlugin()` — reuse the existing `isDisposableEmail` in the action pipeline `preRegister`
  - `discordAlertPlugin({ webhookUrl, events })`
  - `pagerdutyAlertPlugin({ routingKey, events })` — for security-critical events
  - `geoBlockPlugin({ allowCountries OR denyCountries })` — reads `x-client-country`
  - `hubspotIdentifyPlugin({ apiKey })` — tag users in HubSpot on register/login
  - `intercomIdentifyPlugin({ secretKey })` — server-side Intercom identify
  - `posthogIdentifyPlugin({ apiKey })`
  - `mixpanelIdentifyPlugin({ token })`
  - `clearbitEnrichPlugin({ apiKey })` — auto-enrich user data on register
- Docs page in `~/abs/docs`: `/documentation/auth/plugins` — list, install, configure (the "marketplace")
- **Files**: new `packages/plugins/` (or sibling repo), per-plugin file + entry index
- **Tests**: each plugin in isolation (Slack mock, no real API calls)

**Effort:** 1.5-2 stretches.

### A7. `0.30.0-beta.6` — SAML 2.0 IdP role

**Why:** we're currently a SAML **SP** (consume IdP-issued assertions from Okta/Microsoft Entra/etc.) but not a SAML **IdP** (issue our own assertions to legacy SaaS). Salesforce, Workday, Concur, lots of older SaaS only accept SAML SSO. Matters whenever someone wants to use `@absolutejs/auth` AS their identity source for those.

- `POST /sso/saml/idp/sso` — receive an AuthnRequest from a registered SP, validate, redirect to login if no session, then POST a signed Response back to the SP's ACS URL
- `GET /sso/saml/idp/metadata` — IdP metadata for SP-side configuration
- New `SamlServiceProviderStore` (the inverse of the existing SP-side connection store) — one row per SP we issue assertions to: entity_id + ACS_url + signing cert
- `samlIdpSigningKey` config — X.509 cert + private key for signing assertions (separate from the OAuth signing key)
- IdP-initiated SSO (in addition to SP-initiated): `GET /sso/saml/idp/initiate?sp=<entity_id>` — admin starts the flow
- **Files**: new `src/sso/samlIdp.ts` (mirrors the existing `samlSp.ts` shape), `src/sso/samlIdp.routes.ts`, new SP store (in-mem + Postgres)
- **Tests**: AuthnRequest → assertion round-trip, signature verification, IdP-initiated flow, metadata endpoint shape

**Effort:** 3-4 stretches (biggest single item this cycle).

### A8. `0.30.0` stable

- Promote `beta.6` → `latest`
- COMPETITIVE-ANALYSIS.md: add new ✅ rows for /userinfo, JAR, bulk-import, federated tokens, strong fingerprinting, plugins library, SAML IdP
- Release commit + push
- Bump intent dep if any of the new bits get wired in (only adaptive fingerprinting is likely)

---

## Phase B — Intent: upgrade adaptive fingerprint to the strong client-side hash

The only intent-side follow-up worth doing alongside this cycle. The current `riskConfig.ts` uses the weak server-side `fingerprintDevice` (UA + accept-language + IP). Once A5 ships, swap to the client-side fingerprint posted as `x-client-fingerprint` from `SigninSection.tsx`.

- `SigninSection.tsx`: `collectDeviceFingerprint()` on mount, send as `x-client-fingerprint`
- `riskConfig.ts`: `headers['x-client-fingerprint']` becomes the deviceId source (fallback to current behavior)
- No DDL change (device_id column is already varchar(255))
- VPN-login test should still trigger `new_device` (the strong fingerprint won't survive a different browser); same-device-from-VPN now correctly stays "known device" because the canvas+audio hash is location-independent

**Effort:** 0.5 stretch.

---

## Effort + cut points

| Phase | Items | Rough effort | Safe stop after? |
|---|---|---|---|
| A1 | /userinfo + prompt/max_age | 0.5 stretch | ✓ — minor conformance fixes |
| A2 | JAR | 1 stretch | ✓ |
| A3 | Bulk import helpers | 1 stretch | ✓ — adoption ROI |
| A4 | Federated token vault | 1 stretch | ✓ |
| A5 | Strong client fingerprint | 1.5 stretches | ✓ — biggest single security win |
| A6 | Plugins package | 1.5-2 stretches | ✓ — adoption ROI |
| A7 | SAML 2.0 IdP | 3-4 stretches | ✓ — biggest individual item |
| A8 | stable cut | 0.25 stretch | natural cap |
| B | intent fingerprint upgrade | 0.5 stretch | depends on A5 + A8 |

**Total cycle:** ~10-12 stretches at marathon pace. Splittable.

**Sequencing options:**
- **All-in**: A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → B
- **Highest-ROI only**: A3 (bulk import) + A6 (plugins) — these drive ADOPTION the most. ~2.5-3 stretches.
- **Spec-only**: A1 + A2 + A7 — closes the last spec gaps. ~4.5-5.5 stretches.
- **Skip A7**: shave the biggest item. SAML IdP is the longest tail of legacy customer need.

**Order recommendation**: A1 → A3 → A6 → A4 → A5 → B → A2 → A7 → A8.
- Small/foundational first (A1)
- Adoption ROI early (A3, A6) — these make the package more useful immediately
- Then the bigger product bits (A4, A5)
- Intent gets the fingerprint upgrade
- Then the standards-conformance items (A2)
- SAML IdP last because it's the biggest + most isolated
- Stable cut at the end

---

## What stays a non-goal even after 0.30.0

After A1–A7, the only things competitors have that we don't would be:

- **Hosted infrastructure** — SaaS, not library
- **Drop-in UI components** — primitives + composables philosophy (HTMX special case)
- **Cross-customer threat-intel data network** — requires SaaS aggregation
- **Hosted publishing platform / install analytics for plugins** — npm IS the platform
- **OpenID conformance certification** — operational work, not code
- **Behavioral biometrics** (typing dynamics, mouse movement) — Stytch claims this; gives marginal value, requires their data network

After this cycle, the package is decisively "feature-complete vs every self-hosted competitor" with no realistic remaining items. Future work would be docs, examples, framework composables (Vue/Solid/Svelte), and shared-cache implementations — all enhancements rather than new capabilities.
