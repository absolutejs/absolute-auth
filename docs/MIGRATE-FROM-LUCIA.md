# Migrating from Lucia (v3) to `@absolutejs/auth`

Lucia was deprecated in 2024. The maintainer's note —
*"database adapters have been a significant complexity tax"* — is exactly
the problem `@absolutejs/auth` solves by **owning the schema** (via
Drizzle migrations + the `bunx absolute-auth migrate` CLI) instead of
abstracting around yours.

If you're on Lucia v3, this guide walks you through the migration
end-to-end. It assumes Postgres + Drizzle ORM; SQLite + better-sqlite3
follow the same flow with the obvious column-type swaps.

> Status: tested against Lucia v3.2.x. Open an issue with your Lucia
> config snippet if you hit a shape this guide doesn't cover.

## What you keep

- **Your user table** — `@absolutejs/auth` doesn't rename `users.id`,
  drop fields, or require you to give up your domain columns. The
  migration adds `users.sub` (UUID) alongside whatever you already have.
- **Session semantics** — server-side sessions with an httpOnly cookie,
  same trust model as Lucia. We use Redis or in-memory; the cookie name
  is `user_session_id` (configurable).
- **Argon2id password hashes** — Lucia's default. We accept them
  unchanged (`@absolutejs/auth` uses `Bun.password.hash` which also
  defaults to argon2id).

## What changes

| Lucia | `@absolutejs/auth` |
|---|---|
| `lucia.createSession(userId, attributes)` | Implicit — `auth<UserType>()` creates the session on a successful OAuth callback or `signin.email({...})`. |
| `lucia.validateSession(sessionId)` | Use the `protectRoutePlugin` decorator on routes that need an authenticated user. |
| `lucia.invalidateSession(sessionId)` | `await authSessionStore.removeSession(sessionId)` or hit `/oauth2/signout`. |
| `lucia.invalidateUserSessions(userId)` | `await authSessionStore.removeUserSessions(userId)`. |
| `getUserAttributes` hook | Move logic into your route handler; the user is already in `context.user`. |
| Custom `Adapter` (SQLite / Postgres / D1) | Not needed — schema is fixed via Drizzle migrations. |
| `Lucia.Register` module-augmentation trick | Plain generic — `auth<MyUser>({...})`. |

## Step-by-step

### 1. Install + bootstrap

```bash
bun add @absolutejs/auth elysia citra
bunx absolute-auth migrate
```

The CLI generates the Drizzle migrations for `users`, `auth_identities`,
`auth_sessions`, `auth_login_history` (adaptive risk), and so on. Run
them against your DB.

### 2. Backfill from Lucia's tables

Lucia v3 has `user`, `session`, and `key` (or `oauth_account` depending
on your adapter setup). Migrate each row:

```ts
// scripts/migrateFromLucia.ts
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

// 1. Users — Lucia's `user` → @absolutejs/auth's `users`
//    Generate fresh UUIDs for `sub`; keep your existing primary key
//    aliased in `legacy_id` for downstream-FK rewrites if needed.
await sql`
  INSERT INTO users (sub, email, created_at, /* your fields */)
  SELECT
    gen_random_uuid()::text,
    email,
    COALESCE(created_at, NOW()),
    /* your fields */
  FROM lucia_user
  ON CONFLICT (email) DO NOTHING
`;

// 2. OAuth identities — Lucia's `key` rows with `:` prefix
//    (e.g. `google:1234567890`) → auth_identities
await sql`
  INSERT INTO auth_identities (id, auth_provider, provider_subject, user_sub)
  SELECT
    split_part(k.id, ':', 1) || ':' || split_part(k.id, ':', 2),
    split_part(k.id, ':', 1),
    split_part(k.id, ':', 2),
    u.sub
  FROM lucia_key k
  JOIN lucia_user l ON l.id = k.user_id
  JOIN users u ON u.email = l.email
  WHERE k.id LIKE '%:%'
  ON CONFLICT DO NOTHING
`;

// 3. Password hashes — Lucia's `key` with `hashed_password`
//    Argon2id format carries over unchanged.
await sql`
  UPDATE users SET password = k.hashed_password
  FROM lucia_key k
  JOIN lucia_user l ON l.id = k.user_id
  WHERE k.hashed_password IS NOT NULL
    AND users.email = l.email
`;

// 4. Sessions — DON'T migrate. Lucia uses opaque IDs; we use a different
//    cookie name + scheme. Force a re-login on cutover by NOT copying
//    the session table.
```

### 3. Wire the new auth config

```ts
import { Elysia } from 'elysia';
import { auth, createNeonAuthSessionStore } from '@absolutejs/auth';

type MyUser = {
  email: string;
  sub: string;
  // …whatever your domain user has
};

const authSessionStore = createNeonAuthSessionStore<MyUser>();

const app = await auth<MyUser>({
  authSessionStore,
  // your existing OAuth provider config (Google, GitHub, …)
  providersConfiguration: { google: { /* … */ } },
  // The bridge from a decoded token → your user shape.
  // Lucia's `getUserAttributes` lives here now.
  getUser: (decoded) => ({
    email: decoded.email,
    sub: /* … */,
  }),
});
```

### 4. Replace `validateSession` call sites

Before (Lucia):

```ts
app.get('/me', async (ctx) => {
  const { session, user } = await lucia.validateSession(
    ctx.cookies.get('auth_session') ?? ''
  );
  if (!session) return ctx.error(401);

  return user;
});
```

After (`@absolutejs/auth`):

```ts
import { protectRoutePlugin } from '@absolutejs/auth';

app
  .use(protectRoutePlugin<MyUser>())
  .get('/me', ({ user }) => user); // typed as MyUser, throws 401 if unauthenticated
```

### 5. Switch the cookie name (optional)

Lucia's default cookie is `auth_session`. `@absolutejs/auth` uses
`user_session_id`. If you want zero re-logins after the cutover (you
also can't — see Step 2 — but if you've decided to migrate sessions
manually), the session cookie config is overridable. We recommend
NOT migrating sessions; the cutover is the right moment to force
re-auth.

### 6. Drop the Lucia tables

```sql
DROP TABLE lucia_session, lucia_key, lucia_user;
```

(After the migration script verifies zero new user creation in Lucia.)

## What you get post-migration that you didn't have before

- **OIDC provider role** — your app can issue OAuth tokens to other apps
  via `/.well-known/openid-configuration`. Lucia is an RP only.
- **MFA (TOTP) + passkeys (WebAuthn) + magic links** — all first-party,
  Lucia required third-party libraries.
- **SCIM 2.0 + SAML 2.0 IdP role** for enterprise SSO.
- **Tamper-evident audit log** with hash-chained events + SIEM streaming.
- **Adaptive risk** + strong device fingerprinting on every login.
- **Drop-in OAuth provider library** ([citra](https://www.npmjs.com/package/citra))
  — every quirk Slack/LinkedIn/QuickBooks/Salesforce inflict on you,
  centrally handled. See [OAUTH-PROVIDER-QUIRKS.md](./OAUTH-PROVIDER-QUIRKS.md).

## Common questions

**Q: My Lucia setup used SQLite. Does this work?**
Yes — Drizzle supports SQLite, the migration SQL above swaps to the
SQLite dialect. The argon2id verifiers, OAuth flows, and TS types are
all SQL-dialect-agnostic.

**Q: I have custom `DatabaseUserAttributes` from Lucia's module
augmentation. How do I port that?**
That's just your `UserType` now. Pass it as the generic to `auth<T>()`
— compile-time enforced everywhere downstream, no module augmentation.

**Q: I used Lucia's "key" abstraction for non-OAuth identities (Apple
Sign In via custom claims, magic-link tokens, etc.). Where do those go?**
Magic links: built-in via the `passwordless` block. Apple Sign In:
treated as a standard OAuth provider via citra. Any other custom
"identity" you owned: write a row into `auth_identities` with your
chosen `auth_provider` value (e.g. `apple`).

**Q: I want to keep Lucia's sessions live during the cutover.**
The cleanest path is to NOT — force a re-login. If you must, write a
session-bridge middleware that reads Lucia's `auth_session` cookie,
calls Lucia's `validateSession`, mints a new `@absolutejs/auth` session
in our store, and sets the new cookie. Single-PR rollback path:
remove the bridge, Lucia's cookie expires naturally.
