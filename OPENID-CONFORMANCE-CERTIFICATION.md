# OpenID Conformance Certification — plan for later

**Status:** deferred until budget. Captured 2026-05-27 so the work is concrete the moment we're ready to fund it.

The package already passes the technical bar for OpenID Conformance Certification on at least three profiles (we believe; see "Self-test phase" below to verify). The blocker is the OpenID Foundation membership + per-profile certification fees, not engineering. This doc spells out exactly what's required so the spend is justifiable when we get to it.

---

## What it is

The OpenID Foundation runs a self-certification program where an OAuth/OIDC implementation runs an open-source test suite against a list of profiles (Basic OP, Implicit OP, Hybrid OP, Config, Form Post, RP-Init Logout, FAPI 1.0 Advanced, FAPI 2.0 Security, FAPI 2.0 Message Signing, CIBA, Federation, etc.). If the suite passes, the implementer signs a self-attestation declaring conformance, pays the per-profile fee, and gets listed at <https://openid.net/certification/>.

The badge is the deliverable. It opens doors in three procurement contexts:

1. **Financial-services consumers** — UK Open Banking, Australia CDR, Brazil Open Finance, OpenID for Healthcare all require FAPI 1.0 / FAPI 2.0 certified providers. No badge → not in the RFQ.
2. **Enterprise procurement** — large IT shops use the certification list as a shortlist filter. Easier to win an RFP when your name is on openid.net/certification next to Auth0 / Okta / WorkOS / Keycloak.
3. **EU public-sector / eIDAS 2.0** — emerging mandate; certified providers will be preferred suppliers.

For everyone else (the typical SaaS / B2B consumer) the badge is mostly marketing. Useful, but not gating.

---

## Profiles available to us

The OPs (OpenID Providers) profile family is what we'd certify. We are an OP. Profiles we should consider, in priority order:

| Profile | Why we want it | Our current readiness |
|---|---|---|
| **Basic OP** | Table-stakes — proves we implement OIDC Core 1.0 + Discovery correctly | Ready — implements authorization_code + PKCE + JWT id_token + discovery |
| **Config OP** | Proves `.well-known/openid-configuration` advertises correctly | Ready |
| **Form Post OP** | Implements OAuth 2.0 Form Post Response Mode | Not implemented — would need ~half day |
| **Dynamic OP** | Proves DCR (RFC 7591) | Ready (0.29.0) |
| **RP-Initiated OP Logout** | OIDC RP-Initiated Logout 1.0 | Ready (0.29.0) |
| **Back-Channel Logout OP** | OIDC BCL 1.0 | Ready (0.29.0) |
| **FAPI 1.0 Advanced OP** | UK Open Banking baseline | **Need:** mTLS client auth (G4 in `ROADMAP-NEXT.md`), JARM (G10), tighter signing alg policy. Most of the rest is there (PAR, JAR, private_key_jwt, DPoP) |
| **FAPI 2.0 Security OP** | Modern baseline | Same gaps as FAPI 1.0 Advanced |
| **FAPI 2.0 Message Signing OP** | Builds on FAPI 2.0 Security; requires JARM | Adds JARM on top of FAPI 2.0 Security |
| **CIBA OP** | Banking second-device push auth | **Need:** CIBA (G3 in `ROADMAP-NEXT.md`) |
| **Federation OP** | OIDC Federation 1.0 | Not implemented; rarely used outside academic/govt PoCs |

The minimum honest badge set is **Basic OP + Config OP + Dynamic OP + RP-Init Logout OP + Back-Channel Logout OP** — five profiles, all of which should pass with what's shipped through `0.34.0` plus the Form Post addition. That's the "OIDC Certified" line on openid.net.

The aspirational badge set is **+ FAPI 2.0 Security OP + CIBA OP** which requires the ROADMAP-NEXT G3 + G4 (CIBA + mTLS) plus a small JARM scaffold (G10).

---

## What needs to happen on the engineering side

Before paying anyone:

1. **Set up a public reference instance.** The conformance suite needs a live OP at a real URL it can hit. Could be:
   - An always-on instance running on DigitalOcean / Fly / Render with the package's `@absolutejs/auth` configured
   - Reuse the intent prod URL (intentshowcases.com) — risky because the conformance suite tries weird inputs
   - **Recommendation:** dedicated `oidc-conformance.absolutejs.com` instance running a minimal `defineAuthConfig` with every block enabled, isolated from intent

2. **Run the self-test suite locally.** The OpenID conformance test suite is open source at <https://gitlab.com/openid/conformance-suite>. Self-hostable via Docker. Free to run; finding gaps now (before paying for certification) is the whole point of the self-test phase.

   ```bash
   git clone https://gitlab.com/openid/conformance-suite.git
   cd conformance-suite
   mvn package
   docker-compose up
   # configure test profile + point at our public reference instance
   ```

3. **Fix every failing test.** Likely surface a handful of:
   - Wrong-case header tolerance the suite intentionally tries
   - Specific error-response formats (`error_uri`, `error_description`) we might be looser about
   - Edge cases in `prompt` / `max_age` combination logic
   - Discovery field-presence quirks

4. **Set up CI to keep certification passing.** Once certified, drift = embarrassment. Add a nightly job that runs the conformance suite against the reference instance and alerts on failure.

5. **Form Post Response Mode** (if going for Form Post OP) — half a day of work. Add `response_mode=form_post` handling to `/authorize`; instead of redirecting with params, render an auto-submitting HTML form POSTing to `redirect_uri`.

---

## What needs to happen on the operations / paid side

In rough order:

### 1. OpenID Foundation membership

Required to sign certifications. Tiered:

| Tier | Annual fee (USD) | Notes |
|---|---|---|
| **Non-profit** | $1,000 | Doesn't apply to us |
| **Individual** | $50 | Limited voting; can certify in own name. Probably enough to start. |
| **Sustaining (corporate)** | $10,000+ | Sliding scale by company size. Real benefits (board seat, working-group voting) but not required for certification |

**Recommendation:** **Individual at $50/yr** is enough to certify under "Alex Kahn" or "AbsoluteJS"-as-DBA. Most OSS projects do this. Bump to a Sustaining tier later if a paying enterprise consumer asks for the corporate branding.

### 2. Per-profile certification fees

Currently (verify before paying — check <https://openid.net/certification/op_servers/> for the live fee schedule):

| Profile | Fee per submission |
|---|---|
| Basic OP | $200 |
| Each additional OP profile (Config, Dynamic, Form Post, etc.) | $100 each |
| FAPI 1.0 / 2.0 profiles | $400+ each |
| Re-certification when spec rev changes | Pro-rated |

For the **minimum honest badge set** (Basic + Config + Dynamic + RP-Init Logout + Back-Channel Logout = 5 profiles):

```
$200 (Basic) + 4 × $100 (other OP) = $600 one-time
+ $50/yr OpenID Foundation Individual membership
= ~$650 to get on openid.net/certification
```

For the **aspirational FAPI badge set** (above + FAPI 2.0 Security + CIBA):

```
$650 (above) + $400 (FAPI 2.0 Security) + $400 (CIBA) = ~$1,450 one-time
+ $50/yr membership
+ engineering time for G3 / G4 / G10 from ROADMAP-NEXT.md
```

### 3. Public listing

Once certified, the badge appears at <https://openid.net/certification/>. Worth mentioning prominently in `README.md`, the docs site landing page, and any RFP responses.

---

## Recommended execution order when funded

Sequenced so each step de-risks the next:

1. **Now (free, no budget):** stand up the reference instance + run the self-test suite locally. Identify gaps. Fix them. Validate that the minimum honest badge set passes 100% on our own infrastructure.
2. **Phase 1 ($650):** OpenID Foundation Individual membership + submit Basic OP + Config OP + Dynamic OP + RP-Init Logout OP + Back-Channel Logout OP certifications. Add badge + listing to README + docs. This is the "OIDC Certified" branding.
3. **Phase 2 (engineering):** ship ROADMAP-NEXT G3 (CIBA) + G4 (mTLS) + G10 (JARM as minor follow-up) — these unlock FAPI 2.0.
4. **Phase 3 ($800):** submit FAPI 2.0 Security OP + CIBA OP certifications. Add to README + docs + competitive matrix.
5. **Maintenance ($50/yr + CI):** nightly conformance suite run; auto-alert on regressions.

**Total to "OIDC Certified + FAPI 2.0":** ~$1,450 one-time + $50/yr + the engineering work from ROADMAP-NEXT G3/G4/G10.

---

## Why this matters / why this isn't urgent

**Matters because:** every enterprise procurement page that lists "OIDC Certified" as a requirement filters us out today. Banking-adjacent consumers (UK Open Banking, Brazilian Pix, EU SCA/PSD3) can't even consider us without FAPI. The badge is the only way to play in those markets — there is no alternative legitimacy signal.

**Not urgent because:** the typical SaaS / B2B / startup consumer doesn't ask for the badge. Our current target market (TS-native, self-hosted, Bun/Elysia-friendly teams) cares about the spec compliance itself (which is solid) more than the OpenID Foundation's blessing of that compliance. The badge is procurement-gated, not technology-gated.

**Trigger to revisit:** when one of (a) we have a real prospect that requires the badge, (b) someone wants to fund it for marketing, (c) we hit a quiet quarter and want to lay the groundwork before a prospect appears. Until one of those, this doc is the parking-brake.
