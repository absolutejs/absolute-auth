# `@absolutejs/auth` — Competitor Pain-Point Research (May 2026)

> Companion to `OPENID-CONFORMANCE-CERTIFICATION.md` and the original
> "Competitor scout" memory (task #116). Where that one was a feature
> matrix, this one is *what developers actually complain about*. Sources
> are linked at the bottom — date-stamped so signal-vs-noise is visible.

## 1. TL;DR — the 7 cross-competitor pain themes

**1. Database adapter complexity is the silent killer.** Lucia's maintainer
flat-out said this is why he killed the project. Better Auth users hit it
from the other direction — schema drift on Prisma/Drizzle upgrades,
`additionalFields: string[]` writing stringified JSON in v1.4.5+, the CLI
generating the wrong ORM's schema when both are present. NextAuth's
Credentials provider silently refuses to work with a database adapter
and surfaces it only in debug mode. The pattern: every library that
abstracts "the database" eventually creates a worse abstraction than
just owning the schema.

**2. Pricing surprises drive enterprise migrations more than any feature
gap.** Auth0 is the canonical example: bills jumping 15.54× on 1.67× user
growth; a 2,500-MAU customer quoted $34k/year just to enable SAML. Clerk
hits $2,025/month at 100K MAU. WorkOS charges $125/connection — *"the
cost of WorkOS SSO for a single customer exceeds the price of our lowest
tier."* Every hosted vendor has a growth-penalty story attached.

**3. The vendor outage = your-site-is-down problem.** Val Town: *"if Clerk
goes down, the whole website goes down"* because Clerk validates sessions
on every request. Auth0 had a "Full Service Disruption" on May 19, 2025.
Whoever holds session refresh holds the off switch.

**4. Long beta / churn / abandonment fear.** Auth.js v5 in beta since May
2023; main contributor quit January 2025. Lucia deprecated mid-2024.
Better Auth ships 220+ bug-fix releases per cycle and has serial 1.4.x
regressions where `trustedOrigins` broke cross-origin auth across
consecutive patches. Developers are exhausted from picking the "wrong"
library every 18 months.

**5. OAuth provider-quirk hell.** Nango (2026): *"the real-world OAuth
experience is comparable to JavaScript browser APIs in 2008."* LinkedIn
breaks silently when PKCE is included; Slack has two scope types;
QuickBooks adds `realmID`; Salesforce returns `instance_url`. Libraries
that abstract OAuth still leak these into the developer's day. Citra-
backed `@absolutejs/auth` ships per-provider knowledge centrally — a
real moat.

**6. Edge runtime fragmentation breaks adapters.** NextAuth's database
adapter doesn't work in Edge middleware. Better Auth's `@better-auth/
expo` forces RN deps into Node backends; `jose` breaks iOS bundling on
`node:buffer`; Apple Sign-In hangs in TestFlight prod. Every runtime
split is an unfixable bug factory.

**7. "I had to read the source to understand it" docs pain.** Lucia: *"such
a mess."* Keycloak docs *"cover only simple scenarios and fail to give
direction for complex, real-world setups."* Auth0: *"Is it only me or
Auth0 documentation is really bad?"* Better Auth: *"v1.4.0 default
User-Agent header may cause Safari CORS errors (undocumented breaking
change)."*

## 2. Per-competitor breakdown

### Better Auth — heir apparent, but the heir has cracks

**Top pain points (open issues May 2026):**
1. **Plugin-induced TypeScript inference collapse** — `customSession` +
   `organization` plugin loses `activeOrganizationId` (#3233);
   `adminClient` requires manual `as` casts (#6642); the
   `haveIBeenPwned` plugin "messes with typescript" (#2413). Eden
   Treaty loses cross-package inference when betterAuth is imported
   through a barrel (elysia/eden#215).
2. **Patch-version regressions across cross-origin auth** — 1.3.29 →
   1.4.9: serial `trustedOrigins`/CORS regressions broke Hono on CF
   Workers, Next.js server components, Electron `file://`, TanStack
   Start. *"v1.4.8 broken and unusable due to trusted origins issues."*
3. **CVE-2025-61928** (Oct 2025) — unauthenticated API-key creation = MFA
   bypass + account takeover.

**Does `@absolutejs/auth` solve?** TS inference (yes — generics over
`UserType` not module augmentation); patch regressions (yes,
structurally smaller surface = less to regress); security (drizzle
migrations + tamper-evident audit + SIEM streaming).

**Gap:** Better Auth has Convex/CF Workers/Astro/SolidStart/Nuxt/
TanStack/Hono/Express adapters. AbsoluteJS-only Elysia is a real
constraint — pitch isn't "we run everywhere" but "we run *correctly*
on Bun/Elysia, where the type system actually closes."

### NextAuth.js / Auth.js — the legacy giant in decline

**Top pain points:**
1. **Three years of beta-tag v5** + main contributor left Jan 2025 +
   Auth.js team joined Better Auth Sept 2025. Existential abandonment.
2. **Credentials provider intentionally crippled** — silently
   incompatible with the database adapter, debug-mode-only error.
3. **Edge ≠ Node ≠ middleware** — database sessions incompatible with
   Edge middleware; CVE-2025-29927 let one header bypass middleware
   auth. Next 16 moved middleware off Edge *again*, breaking everyone's
   mental model a third time.

**Gap to capture migrators:** The huge NextAuth exodus is Next-shaped.
A documented "use AbsoluteJS as a sidecar to Next" recipe unlocks it.

### Lucia (deprecated) — the migration goldmine

**What devs wished Lucia did:**
1. **Don't make me own the schema** — users wanted Lucia to either pick
   or generate, not negotiate.
2. **Pick an abstraction level.** *"Was it a complete solution or
   utility API? This ambiguity created expectation mismatch."*
3. **Documentation as "such a mess"** — maintainer-acknowledged.

**Gap:** The "Lucia v3 → ?" cohort wants exactly what AbsoluteJS offers.
A **literal Lucia migration guide** in the docs is free traffic.

### Clerk — hosted darling, real outage problem

**Top pain points:**
1. **Cost at scale** — $2,025/month at 100K MAU vs Better Auth at
   $25–50/month on a Postgres box.
2. **5 req/sec global rate limit** on user-data endpoint forcing you to
   maintain a duplicate user table via webhooks. *"Webhooks trigger
   inconsistently."*
3. **SPOF** — *"if Clerk goes down, the whole website goes down."* Only
   2–3 nines since May 2025. Free tier forces re-auth every 7 days. No
   EU residency.

**Gap:** Clerk's stickiness comes from `<SignIn />` components.
Headless admin portal (0.26.0) is a start but we don't ship pre-built
sign-in components. Drop-in `<SignIn />`/`<UserButton />` directly
answer *"but I'd lose Clerk's `<UserButton />`."*

### Auth0 — angriest user base in the industry

**Top pain points:**
1. **Pricing shocks** post-Okta: 15.54×, 300%, 1500% bill increases.
   $34k/year for SAML on 2,500 MAUs.
2. **Support erosion**: 9-month-unfixed enterprise bugs; *"5–10 support
   agents asking for repeated information."*
3. **Migration is hell**: incompatible password hashes, identity
   re-linking, 1000-user search cap.

**Gap:** A first-class **`auth0-import` CLI** consuming Auth0's user
export JSON would be the single highest-impact migration accelerator.

### Keycloak — the JVM elephant

**Top pain points:**
1. **Operational complexity**: HA clustering needs Java + networking +
   DB ops. Embedded Infinispan loses data when nodes leave concurrently.
2. **Java SPI lock-in**: *"You need to upload a jar to execute custom
   flows"* — every customization is a Java compile.
3. **FreeMarker theming**: *"very old technology"*; six-month release
   cadence + advice to not skip majors = perpetual upgrade pipeline.

### ORY (Kratos/Hydra/Keto) — split-architecture confusion

1. **Three products are too many**: *"I have problems understanding
   kratos and hydra workings together"* (verbatim thread title).
2. **Self-service UI not included** — you ship without a login page.
3. **Production-setup ceremony** before you have a login form.

**Gap:** With FAPI 2.0 baseline + DPoP + PAR + private_key_jwt + RFC 8705
+ RFC 9207 + JAR shipping, we're at full standards parity with ORY in
*one library*. Marketable claim ORY can't match.

### Supabase Auth — bundled convenience

1. **RLS performance cliff**: `user_id = auth.uid()` sequential-scans on
   unindexed tables.
2. **Random logouts / SSR session issues**: *"I assume the
   implementation isn't refreshing the JWT."*
3. **CVE-2025-48757**: 10.3% of Lovable apps shipped with RLS off
   because Supabase's SQL editor creates tables without RLS by default.

**Pitch:** Swap Supabase Auth out, keep the Postgres. Thin abstraction
over `auth.signIn`.

### Stytch / WorkOS / FusionAuth / Hanko / Descope / Kinde

- **Stytch**: *"developers unhappy with how often they rely on the
  support team."*
- **WorkOS**: $125/connection SSO. *"Pay-per-use would be nice."*
- **FusionAuth**: *"UI/DX feel a generation behind."*
- **Hanko/Kinde/Descope**: smaller install base, same structural
  Clerk/Auth0 lock-in concerns.

## 3. Positioning angles for the landing-page hero

**A — "Your auth library shouldn't go down with your provider."**
Self-hosted, library-not-SaaS. No MAU billing. No outages you don't
cause. Speaks to Auth0/Clerk/Okta-acquisition exodus and Val Town
outage story.

**B — "Owns the schema. Owns the types. Owns the runtime."**
Drizzle migrations included. Generics that actually infer. One
runtime, no Edge/Node/Worker mismatch. Anti-Lucia + anti-NextAuth-
Credentials + anti-Better-Auth-plugin-type-collapse.

**C — "FAPI 2.0 baseline in one `bun add`."**
DPoP, PAR, private_key_jwt, RFC 8705 mTLS, RFC 9207 — all in one
package. ORY-grade standards, library-grade DX.

**D — "The library that doesn't make you migrate every 18 months."**
Stable 0.41.0. 431+ tests. Predictable breaking-change policy.

**E — "Built for Bun + Elysia. Not adapted to it."**
Native, not ported.

**Recommend leading the hero with A, sub-hero with C, proof with D+E.**

## 4. Improvement candidates (ranked by effort × impact)

| # | Candidate | Pain it answers | Effort | Impact |
|---|-----------|-----------------|--------|--------|
| 1 | **`bunx absolute-auth import {auth0,clerk,supabase,lucia,nextauth}`** CLI — consume their export JSON, generate AbsoluteJS schema + user rows with hash mapping | The #1 stickiness story for every hosted vendor + dead library. Better Auth has docs but no CLI; nobody has all five. | Med | Very High |
| 2 | **Drop-in headless React/Vue/Svelte/Solid components** for sign-in, sign-up, password reset, MFA enrollment, passkey enrollment | Clerk's `<UserButton />` is genuinely sticky; previously marked "deliberate non-goal" — worth revisiting given migrator pattern. | High | Very High |
| 3 | **Edge / Worker / Hono / Next-sidecar deployment recipes** in docs | The "one runtime" purism is correct philosophically but the migrator market is on Next/Vercel. A worked example unlocks the NextAuth-exodus cohort. | Med | High |
| 4 | **Plugin type-inference test suite + golden file** (customSession × organization × admin × MFA, etc.) | Better Auth's plugin combinatorial bugs are the "looks great until it doesn't" complaint. Pre-empt as we add plugins/actions. | Low | High |
| 5 | **First-class Cloudflare D1 / Turso / Neon HTTP adapter** (Postgres-over-HTTP) | Realistic deployment for a Bun + Elysia user in 2026. Not yet tier-1 documented. | Low–Med | Med |
| 6 | **Drizzle-introspection mode for existing schemas** — plug in *existing* `users` table without forcing renames | Lucia's #1 complaint was "your schema doesn't match mine." | Med | Med |
| 7 | **Public status / SLO page for the library itself** (releases/month, MTTR security patches, regression count per minor) | Trust signal directly answering the Better-Auth-220-bugfixes / NextAuth-3-year-beta / Lucia-deprecation trauma. | Low | Med |
| 8 | **First-party "auth incident" runbooks** in docs | Nobody else does this. Cheap, cheerful trust-building. | Low | Med |
| 9 | **"OAuth provider quirk fixtures"** doc — citra centralizes provider config; publish *every nonstandard thing Slack/QuickBooks/LinkedIn/Notion does and how we handle it* | Nango's blog made this a known wound. Owning the answer publicly converts traffic. | Low | Med |
| 10 | **`--strict-fapi` config flag** turning on every FAPI 2.0 requirement at once + warning on misconfig | ORY/Curity charge enterprise prices for this. One flag = marketable. | Low | Med |

**Two highest-leverage moves**: (1) `migrate-from-X` CLI for the top 5
refugee sources, (2) at-least-minimal first-party drop-in sign-in
components. Both directly attack the only moats hosted competitors
still have — user-data stickiness and UI components.

## Key sources

- [Val Town: "From Supabase to Clerk to Better Auth"](https://blog.val.town/better-auth)
- [Lucia deprecation discussion (lucia-auth/lucia#1707)](https://github.com/lucia-auth/lucia/discussions/1707)
- [SSOJet: Top 10 Auth0 Complaints on Reddit](https://ssojet.com/blog/auth0-complaints-reddit-developers)
- [Compile7: Auth0 Pricing, Support, Integration Friction](https://compile7.org/decompile/auth0-pricing-support-issues)
- [HN: Auth.js is now part of Better Auth (Sept 2025)](https://news.ycombinator.com/item?id=45389293)
- [HN: Comparing Auth from Supabase, Firebase, Auth.js, Ory, Clerk](https://news.ycombinator.com/item?id=41923641)
- [HN: Stack Auth launch — Auth0/Clerk complaints](https://news.ycombinator.com/item?id=41194673)
- [Better Auth issues tracker](https://github.com/better-auth/better-auth/issues) — esp. #3233, #6642, #2413, #5159, #7603, #7049, #6358, #6552, #7657
- [NextAuth.js v5 beta discussion #13382](https://github.com/nextauthjs/next-auth/discussions/13382)
- [NextAuth.js Credentials + adapter incompatibility #10966](https://github.com/nextauthjs/next-auth/issues/10966)
- [Wisp: Lucia Auth is Dead](https://www.wisp.blog/blog/lucia-auth-is-dead-whats-next-for-auth)
- [Sirius Open Source: Problems with Keycloak](https://www.siriusopensource.com/en-us/blog/problems-keycloak-unpacking-challenges)
- [Nango: Why is OAuth Still Hard in 2026?](https://nango.dev/blog/why-is-oauth-still-hard/)
- [WorkOS: Top 5 NextAuth Alternatives 2026](https://workos.com/blog/top-nextauth-alternatives-secure-authentication-2026)
- [ZeroPath: Better Auth CVE-2025-61928](https://zeropath.com/blog/breaking-authentication-unauthenticated-api-key-creation-in-better-auth-cve-2025-61928)
- [Hrekov: Is Supabase Vendor Lock-in a Problem?](https://hrekov.com/blog/supabase-vendor-lock)
