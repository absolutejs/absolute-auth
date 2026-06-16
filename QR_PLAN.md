# QR in `@absolutejs/auth` — where it's useful & what to build

**Status:** scouted 2026-05-29 against the current `0.45.x` source. This doc argues QR
belongs **inside `@absolutejs/auth` as a feature**, not as a standalone `@absolutejs/qr`
package, and specifies the work to make every QR-shaped auth flow first-class.

---

## Thesis: QR is a feature, not a product

Run it through the licensing decision flowchart in the global policy:

1. Could a competitor host a QR encoder as a SaaS that competes with absolutejs.ai or an
   adjacent hosted category? **No.** QR generation is a pure client/server primitive with no
   hosted-product story. The best a standalone `@absolutejs/qr` could ever be is **Tier B
   MIT** ("permission without leverage") — the tell that it's *not* a leverage point and
   doesn't advance the own-the-stack thesis.
2. The hard part (Reed-Solomon ECC, masking, version/EC-level selection) is already solved by
   tiny mature libraries you'd wrap anyway. A standalone package is a thin shim over a
   commodity lib — pure maintenance surface, near-zero value-add, and thin shims rot.

QR earns its keep **riding a Tier A host** — and `auth` (BSL-1.1) is exactly that host. The
package *already* produces the URIs that want to become QR codes; it just stops one step short
of rendering them and is missing the one genuinely new flow (cross-device login handoff). Build
QR here, as an opt-in rendering primitive plus one new flow. If the same primitive later proves
useful across two or three Tier A packages, *extract it then* as a Tier B Apache sub-primitive
that rides them — never lead with the package.

---

## Where QR is already implicitly needed (today, unrendered)

The package mints QR-destined URIs in four flows and leaves rendering to the consumer:

| # | Flow | URI produced | Source |
|---|------|--------------|--------|
| 1 | **TOTP enrollment** | `otpauth://totp/{issuer}:{account}?secret=…` | `createTotpKeyUri` — `src/crypto.ts:136` |
| 2 | **OIDC Device Authorization (RFC 8628)** | `verification_uri_complete` | `src/oidc/config.ts:59`, types `src/oidc/types.ts:156` |
| 3 | **OID4VCI credential offer** | `openid-credential-offer://…?pre-authorized_code=…` | `createCredentialOffer` — `src/oidc/vci.ts:109` |
| 4 | **OID4VP verifiable presentation** | `request_uri` for wallet deeplink | `createPresentationRequest` — `src/vc/openid4vp.ts:1` |

Every one of these is a textbook QR target (authenticator-app scan, "scan to log in on
TV/CLI", wallet credential pickup, wallet presentation). Right now each handler hands the
consumer a string and a comment that literally says *"embed it into the QR-encoded offer URI"*
(`vci.ts:109`) — making the consumer reach for a third-party encoder mid-auth-flow. That's the
gap.

---

## The one new flow worth building: cross-device login handoff

Distinct from the RFC 8628 device flow (which is for **input-constrained** devices — TVs,
CLIs — and uses a typed user code). This is the **WhatsApp Web / Discord / ChatGPT** pattern:
a desktop browser shows a QR; the user scans it with a phone that's **already authenticated**;
the desktop session is promoted to logged-in without typing anything.

This is a real, high-value, currently-missing capability — and it slots cleanly onto the
existing session machinery (`src/session/promote.ts`, `multiSession.ts`, `state.ts`,
`anonymous.ts`).

**Flow:**

1. Unauthenticated desktop hits `POST /auth/qr-login/start` → server mints a single-use,
   short-TTL `linkToken` (hash-at-rest, mirroring `PasswordlessTokenStore` in
   `src/passwordless/types.ts`), binds it to the desktop's anonymous session id, and returns
   `{ linkToken, qrPayload }` where `qrPayload` is a deeplink URL (`https://…/auth/qr-login/
   approve?t=…`).
2. Desktop renders `qrPayload` as a QR (via the rendering primitive below) and **long-polls /
   SSE** `GET /auth/qr-login/status?t=…`.
3. Phone (already authenticated) opens the deeplink → `POST /auth/qr-login/approve` with its
   bearer session → server validates the phone session, marks the `linkToken` approved, and
   atomically promotes the desktop's anonymous session to the phone's user (reusing
   `promote.ts`). Single-use consume, exactly like passwordless.
4. Desktop's poll flips `pending → approved`; desktop now holds an authenticated session.

**Security must-haves** (the package already has the primitives for all of these):

- Short TTL (≤2 min) + single-use consume, hash-at-rest — mirror `passwordless`.
- **Explicit approval screen on the phone** ("Log in this device?" with device/IP/geo shown) —
  reuse `src/adaptive/config.ts` geo + the audit context. Never auto-approve on scan.
- Bind the link to the originating anonymous session id; reject approval from a mismatched
  origin context.
- Emit audit events (`composeCallbackAudit` pattern in `src/index.ts`) + a webhook
  (`src/webhooks/dispatcher.ts`) on start / approve / deny / expire.
- Step-up aware: respect `src/routes/stepUp.ts` so a QR login can't silently satisfy an ACR
  the phone session itself didn't meet.

Config block on the top-level `auth()` call, gated like every other feature:
`qrLogin?: { route?, ttlMs?, store, requireApprovalScreen? }`.

---

## The missing primitive: server-side QR rendering

The one thing none of the four existing flows can do today: turn a URI into a scannable image.
Build a single internal renderer, used by all flows.

**Design constraints (Bun + SSR-first):**

- **Render to an SVG string** (and optionally a `data:image/svg+xml` URI). No `<canvas>`, no
  DOM, no native deps — works in Bun server context and SSRs cleanly into React/Vue/Solid/
  Svelte output, matching the existing `src/client/*` framework adapters.
- Pure-function API: `renderQr(text, { ecLevel?, margin?, scale?, dark?, light? }) → string`.
  No I/O, no global state.
- Expose it three ways:
  1. `import { renderQr } from '@absolutejs/auth'` — for consumers who hold a URI from any
     flow and want the SVG.
  2. **Auto-render opt-in** on each producing flow: e.g. TOTP setup response gains an optional
     `qrSvg` field when `mfa.totp.emitQr` is set; same for device-auth, VCI offer, VP request.
     Backwards-compatible — URIs still returned as today.
  3. Framework components: `<TotpEnrollQr />`, `<QrLogin />` in `src/client/components/*`
     (react/vue/solid/svelte), consistent with the existing component dirs.

**Encoding dependency — wrap, don't reimplement.** The QR matrix encoder is the genuinely hard
bit and must not be hand-rolled. Two acceptable paths, in order of preference:

- **Optional peer dependency** on a single small, well-maintained, permissively-licensed
  encoder that can emit an SVG path/string with no DOM (the same pattern the package already
  uses for `@simplewebauthn/*` and `@node-saml/node-saml` — optional peer + `peerDependenciesMeta`).
  Keeps `auth`'s core install lean; QR is only pulled when a consumer renders.
- If no lib cleanly meets "no-DOM + SVG-out + permissive license", **vendor a single
  audited pure-TS QR-encode module** into `src/qr/encode.ts` (the encoding spec is stable and
  small). Vendoring a frozen primitive is fine here precisely because QR has *no* moving target
  — it won't rot the way a live shim would.

Either way the surface the rest of the package sees is just `renderQr()`.

---

## Implementation plan (phased)

**Phase 1 — primitive (no new flows).** `src/qr/renderQr.ts` + encoder decision above. Unit
tests against known QR test vectors. Wire optional `qrSvg`/`emitQr` opt-ins into the four
existing producers (TOTP, device-auth, VCI, VP). Ship the standalone `renderQr` export. This
phase alone removes the "go find your own QR lib" footgun from every current flow.

**Phase 2 — cross-device QR login.** `src/qrLogin/` (routes, types, config, in-memory +
postgres token stores) mirroring the `passwordless/` module layout. Session promotion via
`promote.ts`, audit + webhook wiring, phone approval screen, SSE/long-poll status endpoint.
Top-level `qrLogin` config block + conditional route mount in `src/index.ts`.

**Phase 3 — framework components & docs.** `<QrLogin />` and `<TotpEnrollQr />` across the four
client adapters; htmx renderer variant (`src/htmx/renderers.ts`). README section + a
device-login example under `examples/`.

---

## Non-goals

- **No QR *scanning* / decoding in this package.** See "Scanning — out of scope, and why"
  below. `auth` only ever *produces* QR.
- **No standalone `@absolutejs/qr` package** (see thesis). Revisit only if `renderQr` is needed
  by ≥2 other Tier A packages, at which point extract as Tier B Apache.
- **No image-format zoo.** SVG only (data-URI wrapper optional). PNG/JPEG rasterization is the
  consumer's job if they need it; we don't pull a raster pipeline into an auth library.

---

## Scanning — out of scope, and why

Recurring question ("shouldn't we also decode QR?"). Answer: **no, `auth` is producer-only.**
This is primarily an *architecture* call, with security reinforcing it — not a feature we're
punting on.

**The architecture: in every auth flow, the scanner is a separate device's native camera, so
there's nothing for our web code to decode.** Ask "who holds the camera?" in each flow:

| Flow | Who scans | What decodes |
|------|-----------|--------------|
| Cross-device login handoff | the phone | phone's **native OS camera** → opens deeplink |
| TOTP enrollment | authenticator app (Authy/1Password/etc.) | the app's camera |
| OID4VCI / OID4VP | the wallet app | the wallet's camera |
| WebAuthn hybrid transport (caBLE) | the phone | the **browser/platform authenticator** — not library-accessible anyway |

There is no auth flow where the same web app that is authenticating also needs to operate a
camera. Producer-only isn't a limitation — it's the shape of the problem.

**Security reinforces it.** Bundling `getUserMedia` + a CV/WASM decoder into the auth core
would: (1) bloat install + add a camera-permission prompt for the ~95% who never scan;
(2) expand attack surface in the one package that must stay lean and auditable; (3) invite a
phishable footgun — a "scan any QR to log in" flow where an attacker displays a QR, the victim
scans it, and the attacker's session gets authorized. Keeping decode out steers consumers away
from that anti-pattern.

**The one legitimate scan demand — and where it lives instead.** A kiosk / POS / door reader
scanning a customer's ticket, credential, or presentation QR with a mounted webcam is real
in-browser decode. But that's a *verification surface*, not auth-core: auth's job ends at
producing the payload and verifying it server-side (`verifyPresentationResponse` already does
the latter). Getting bytes off a camera is upstream plumbing. If that use case shows up across
the platform, build a small **client-only `@absolutejs/qr-scanner`** (Tier B MIT — commodity
camera+decode wrapper, no leverage) that feeds a decoded string into auth. Do **not** fuse
scanning into the BSL auth core.

---

## Bottom line

QR is already load-bearing in four `auth` flows and missing exactly two things: a renderer and
the cross-device login handoff. Both belong here, riding the BSL-1.1 host. Build the primitive
in Phase 1 (immediate value, removes a footgun from shipping flows), the handoff flow in Phase
2 (the one net-new, genuinely valuable capability), and resist spinning out a package.
