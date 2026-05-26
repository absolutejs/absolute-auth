# Roadmap — `@absolutejs/auth` 0.29.0 + intent wiring

**Status:** active. Started 2026-05-26. Builds on stable `0.28.0` (RFC 7662 introspection + RFC 7009 revocation + RFC 8628 device flow).

## Goal

Close the remaining OAuth2/OIDC spec gaps a complete IdP is expected to have, add a webhooks block for security-event delivery, and wire two unconsumed package primitives into intent (anonymous sessions + adaptive risk on login). Everything below is additive — no breaking changes to `0.28.0`.

After this, the only items left on the competitive matrix are deliberate non-goals (hosted UI, vendor SOC2, proprietary device-fingerprint data network).

---

## Phase A — Package (4 betas → 1 stable)

Each beta is independently shippable + revertable. Published to the `beta` dist-tag via `bun publish --tag beta`; `latest` only moves on A5.

### A1. `0.29.0-beta.0` — Logout standards

The OIDC Session Management 1.0 + Back-Channel Logout 1.0 + Front-Channel Logout 1.0 trio. Once we federate outward, the absence of these makes coordinated sign-out impossible.

- **`GET/POST /oauth2/end_session`** (RP-initiated logout)
  - Accepts: `id_token_hint`, `post_logout_redirect_uri`, `state`, `client_id`
  - Validates `id_token_hint` is signed by us + `post_logout_redirect_uri` is registered on the client
  - Clears the user session + cookies + fires back-channel pushes for every other RP that shares the session
  - Redirects to `post_logout_redirect_uri` with `state` (or 200 if none given)
- **Back-channel logout** (server-to-server)
  - On session end, look up every client with `backchannelLogoutUri` + an active grant for that user
  - Mint a signed `logout_token` JWT per RFC 8417 SET (claims: `iss`, `aud`, `iat`, `jti`, `sub` and/or `sid`, `events: { 'http://schemas.openid.net/event/backchannel-logout': {} }`)
  - POST to each `backchannel_logout_uri` with `application/x-www-form-urlencoded; logout_token=<jwt>`
  - Retry w/ exp backoff (3 attempts); permanent fail → `LogoutDeliveryStore` DLQ
- **Front-channel logout** (browser-iframe fan-out per spec, optional)
- **New types**: `OAuthClient.backchannelLogoutUri?`, `OAuthClient.frontchannelLogoutUri?`, `LogoutDeliveryStore` (in-mem + Postgres/Neon), `LogoutDeliveryRecord`
- **Discovery gains**: `end_session_endpoint`, `backchannel_logout_supported: true`, `backchannel_logout_session_supported: true`, `frontchannel_logout_supported`, `frontchannel_logout_session_supported`
- **Files**: `src/oidc/logout.ts` (new helpers), `src/oidc/routes.ts` (+routes), `src/oidc/types.ts`, `src/oidc/inMemoryStores.ts`, `src/oidc/postgresStores.ts`, `src/oidc/config.ts`
- **Tests**: end_session honors id_token_hint + redirects with state; back-channel delivers a valid `logout_token` w/ `sid`; retry on 5xx; discovery advertises endpoints; logout fan-out to multiple RPs

### A2. `0.29.0-beta.1` — Modern client auth + DCR

`client_secret_post`/`client_secret_basic` is fine for browser apps; enterprise B2B + federated SaaS need `private_key_jwt` + self-service registration.

- **`private_key_jwt`** (RFC 7521/7523)
  - `OAuthClient.jwks?: JWK[]` (static) OR `jwksUri?: string` (fetched + cached)
  - At `/token` and `/par`: if `client_assertion_type === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'`, verify the `client_assertion` JWT:
    - signed by one of the client's keys
    - `iss === sub === client_id`
    - `aud` includes our token endpoint
    - `exp` valid, `jti` not seen (replay window via new `ClientAssertionJtiStore`)
- **Dynamic Client Registration** (RFC 7591/7592)
  - `POST /oauth2/register` with metadata → `{ client_id, registration_access_token, registration_client_uri, ...echoed_metadata }`
  - `GET/PUT/DELETE /oauth2/register/{client_id}` (RFC 7592, gated by `registration_access_token`)
  - Token rotation on `PUT`
  - Consumer policy hook `onClientRegistration(metadata) => { allow: boolean, transform?: Partial<OAuthClient>, denyReason?: string }`
  - Optional `initialAccessTokenStore` gating (closed model)
- **New stores**: `ClientAssertionJtiStore` (in-mem + Postgres/Neon), `ClientRegistrationTokenStore` (in-mem + Postgres/Neon), `InitialAccessTokenStore` (optional)
- **Discovery gains**: `registration_endpoint`, `token_endpoint_auth_methods_supported` += `private_key_jwt`
- **Files**: `src/oidc/clientAuth.ts` (new), `src/oidc/registration.ts` (new), `src/oidc/routes.ts`, stores, types, config
- **Tests**: assertion w/ JWKS URI + static JWK + replay rejection + audience mismatch + expired + wrong client; DCR create + read + update + delete + reg-token rotation + policy hook deny + initial-access-token gate

### A3. `0.29.0-beta.2` — OAuth hardening

PAR closes URL-shoving attacks; DPoP nonces close replay windows; `acr_values` makes step-up first-class in OAuth (not just our session).

- **PAR** (RFC 9126)
  - `POST /oauth2/par` stores `{client_id, params}` keyed by random `request_uri` (urn:ietf:params:oauth:request_uri:<token>), 90s TTL
  - `/authorize` accepts `request_uri` (and only `client_id` alongside it); looks up + uses
  - `OAuthClient.requirePushedAuthorizationRequests?: boolean` per-client flag → `/authorize` rejects non-PAR requests
  - New `PushedAuthorizationRequestStore` (in-mem + Postgres/Neon)
- **DPoP nonce flow** (RFC 9449 §8)
  - On first DPoP request without a nonce: 401 `use_dpop_nonce` + `DPoP-Nonce` header
  - Subsequent DPoP proofs must include the issued nonce in their `nonce` claim
  - Stateless nonces (HMAC of current 5-min epoch + secret) — no store; sliding window via two-epoch acceptance
- **RFC 9470 step-up (`acr_values`)**
  - `/authorize` accepts `acr_values` (space-separated); recorded into auth code → propagated as `acr` claim into id_token + access_token
  - `claims` request param parsed for essential `acr`/`amr`
  - New OAuth error `insufficient_user_authentication` + helper `requireAcr(token, acrValue)`
  - Consumer hook `getAcr({user, session}) => string` (consumer maps their session state — MFA done, passkey used, etc. — to ACR values)
- **Discovery gains**: `pushed_authorization_request_endpoint`, `require_pushed_authorization_requests_supported: true`, `acr_values_supported`, `claims_parameter_supported: true`
- **Files**: `src/oidc/par.ts` (new), `src/oidc/dpop.ts` (extend), `src/oidc/config.ts`, routes, types
- **Tests**: PAR round-trip + expiry + replay rejection + require-par client flag; DPoP nonce challenge cycle + sliding-window acceptance + replay; `acr` claim propagation + insufficient-acr error + `claims` param essential ACR

### A4. `0.29.0-beta.3` — Webhooks block

Lifecycle hooks are great for in-process reactions; external systems need POSTs. Stripe-shape signing convention.

- New top-level block at `src/webhooks/`
- `createWebhookSink({ url, secret, events?, retry? })` — implements `AuditSink` so it composes with `createTamperEvidentSink`
- POST shape: `{ id, type, payload, timestamp }` (JSON)
- Header `Webhook-Signature: t=<unix>,v1=<hmac>` (Stripe convention; HMAC-SHA256 of `<unix>.<body>`)
- Retry: 3 attempts, exponential backoff (1s, 4s, 16s); on permanent fail → `WebhookDeliveryStore` DLQ
- Event filter (`events?: AuditEventType[]`) — skip non-matching
- Multiple sinks fan out (`webhooks: WebhookConfig[]`)
- Helpers: `verifyWebhookSignature(secret, header, rawBody, toleranceSeconds=300)` for consumers
- **New stores**: `WebhookDeliveryStore` (in-mem + Postgres/Neon)
- **Files**: `src/webhooks/config.ts`, `src/webhooks/sink.ts`, `src/webhooks/verify.ts`, `src/webhooks/types.ts`, `src/webhooks/inMemoryStore.ts`, `src/webhooks/postgresStore.ts`, `src/index.ts`
- **Tests**: HMAC sig stable + verifyWebhookSignature round-trip, retry/backoff (3 attempts then DLQ), event filter skips non-matching, replay tolerance window, multi-sink fan-out

### A5. `0.29.0` stable

- Promote `beta.3` → `latest` via `bun publish` (no `--tag`)
- Update COMPETITIVE-ANALYSIS.md (every row ✅ except deliberate non-goals)
- Cut release commit + push
- Bump intent dep to `0.29.0` so Phase C can land

---

## Phase B — Intent: anonymous/guest sessions

Independent of Phase A — package shipped `createAnonymousSession` + `promoteToSession({anonymous: true})` in beta.6. This phase wires the existing primitive into intent's product flow.

- **Entry points** (which routes get a guest session?): public showcase pages (`/showcases`, `/showcases/[slug]`). NOT `/admin`, NOT `/profile`, NOT API endpoints. New `server.ts` middleware: on first visit to a guest-eligible route with no session cookie → `createAnonymousSession` (cookie set, DB row written w/ `anonymous: true`)
- **Conversion path**: signup form recognizes an anonymous session cookie → calls `promoteToSession({anonymous: true})` instead of creating a new user. Carries over any guest-collected state (saved-showcase list) via the existing `sub`
- **UX**: `GuestBanner` component on showcase pages — "Browsing as guest · Sign up to save". No nag modals
- **Audit**: emit `anonymous_session_created` + `anonymous_session_promoted` events (conversion funnel)
- **Files**: `src/backend/server.ts` (middleware), `src/frontend/components/showcase/GuestBanner.tsx` (new), `src/backend/handlers/signupHandlers.ts` (promote-not-create branch)
- **Verify in prod**: incognito visit → showcase page sets a session cookie + Redis session row with `anonymous: true`; sign up → same `sub`, `anonymous: false`, audit row written

---

## Phase C — Intent: adaptive risk on credential login

Depends on Phase A5 (so we're on stable 0.29.0). Wires the existing `scoreRisk` toolkit (shipped beta.9, unconsumed in intent) into credential login.

- **Wiring**: `scoreRisk(...)` in `credentialsConfig.afterPasswordVerify` (existing hook). If `verdict.score >= stepUpThreshold` → set `isMfaRequired: true`
- **Signals** (consumer-fed, no GeoIP dep):
  - `localHour` — client tz header set on login form submit (fallback: skip `off_hours`)
  - `isProxy` — Cloudflare `cf-connecting-ip` ≠ `x-forwarded-for` heuristic + `cf-warp` header
  - `country` — Cloudflare `cf-ipcountry`
  - `userAgent`, `ip` — request headers
  → contributes `proxy`, `off_hours`, `new_country`, `new_device` signals to the weighted score
- **Stores**: `createNeonKnownDeviceStore` + `createNeonLoginHistoryStore` (already in package); new DDL migration (idempotent) for `auth_known_devices` + `auth_login_history`
- **UX**: "Unusual login from {country} · {when}" badge in profile session list; existing MFA challenge UI handles the step-up — no new screens needed
- **Verify in prod**: log in from a VPN → MFA prompt fires; log in from same trusted device a week later → no prompt; profile session card shows the unusual-login badge
- **Files**: `src/backend/utils/authStores.ts` (add the two new stores), `auth-config.ts` (afterPasswordVerify hook), `db/migrations/00X_adaptive.ts` (new), `src/frontend/components/profile/SessionsCard.tsx` (badge)

---

## Effort + cut points

| Phase | Items | Rough effort | Safe stop after? |
|---|---|---|---|
| A1 | RP-init + back-channel + front-channel logout | 1 stretch | ✓ |
| A2 | `private_key_jwt` + DCR | 2 stretches | ✓ |
| A3 | PAR + DPoP nonce + `acr_values` | 1.5 stretches | ✓ |
| A4 | webhooks | 1 stretch | ✓ |
| A5 | stable promote | 0.25 stretch | natural cap |
| B | guest sessions in intent | 1 stretch | runs parallel to any of A1–A4 |
| C | adaptive on login in intent | 1 stretch | needs A5 |

**Order being executed (per user OK):** A4 → A1 → B → A2 → A3 → A5 → C.

Webhooks first because they have the broadest "people will actually wire this" demand for the smallest build. Logout next because it's the most-asked OIDC spec gap. Guest sessions in parallel with A2/A3 (different stack, no conflict). Adaptive last so it consumes the stable 0.29.0 cut.

---

## Standards reference

- RFC 7521 / 7523 — Client assertion (`private_key_jwt`)
- RFC 7591 / 7592 — Dynamic Client Registration + management
- RFC 8417 — Security Event Tokens (back-channel logout uses these)
- RFC 9126 — Pushed Authorization Requests
- RFC 9449 §8 — DPoP nonce flow
- RFC 9470 — OAuth 2.0 step-up authentication challenge (`acr_values`, `insufficient_user_authentication`)
- OIDC Session Management 1.0 — RP-initiated logout (`end_session_endpoint`)
- OIDC Back-Channel Logout 1.0 — `backchannel_logout_uri` + `logout_token`
- OIDC Front-Channel Logout 1.0 — iframe fan-out
- Stripe Webhook Signing — `Webhook-Signature: t=<unix>,v1=<hmac>` convention
