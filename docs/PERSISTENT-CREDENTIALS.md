# Persistent email/password sign-in (Bun + Elysia 2)

Use this credentials-only setup instead of the social-login manifest recipe.
The same API pattern passed synthetic browser signup, login, logout, booking and
full-container restart tests in Studio using auth 0.80.0. The example deliberately
sends no email and refuses production. For a real business configure email
verification, delivery, password policy, backups and the application's user schema.

Install published auth and a compatible Drizzle release. Set AUTH_DATABASE_URL
securely to a real isolated PostgreSQL database; never substitute a placeholder.
The application owns user records. The auth package owns credentials and sessions.

```ts
import { auth } from '@absolutejs/auth/server';
import { createPostgresAuthSessionStore, createPostgresCredentialStore, runMigrations } from '@absolutejs/auth';
import { SQL } from 'bun';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sql';
import { mkdirSync } from 'node:fs';

if (process.env.NODE_ENV === 'production') throw new Error('Synthetic example: configure verified email and real business policy before production');
type Customer = { id: string; email: string };
const databaseUrl = process.env.AUTH_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "AUTH_DATABASE_URL must point to the isolated acceptance database",
  );
const migrationClient = new SQL({ url: databaseUrl, max: 1, prepare: false });
try {
  await runMigrations({
    blocks: ["sessions", "credentials"],
    client: {
      query: async (text, values) => ({
        rows: await migrationClient.unsafe(text, values ? [...values] : []),
      }),
    },
    log: () => undefined,
  });
} finally {
  await migrationClient.close();
}
const authDb = drizzle({ client: new SQL(databaseUrl) });
const decodeCustomer = (value: unknown): Customer => {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid customer session");
  const id: unknown = Reflect.get(value, "id");
  const email: unknown = Reflect.get(value, "email");
  if (typeof id !== "string" || typeof email !== "string")
    throw new Error("Invalid customer session");
  return { id, email };
};
mkdirSync(".data", { recursive: true });
const db = new Database(".data/customer-example.sqlite", { create: true });
db.exec(
  "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);",
);
const userById = db.query<Customer, [string]>(
  "SELECT id,email FROM customers WHERE id=?",
);
const userByEmail = db.query<Customer, [string]>(
  "SELECT id,email FROM customers WHERE email=?",
);
const insertUser = db.query("INSERT INTO customers(id,email) VALUES(?,?)");
const sessions = createPostgresAuthSessionStore(authDb, decodeCustomer);
export const authentication = await auth<Customer>({
  providersConfiguration: {},
  getUser: (id) => userById.get(String(id)) ?? null,
  authSessionStore: sessions,
  cookieSecure: true,
  credentials: {
    credentialStore: createPostgresCredentialStore(authDb),
    getUserByEmail: (email) => userByEmail.get(email) ?? null,
    onCreateCredentialUser: ({ email }) => {
      const user = { id: crypto.randomUUID(), email };
      insertUser.run(user.id, email);
      return user;
    },
    // Local synthetic mode deliberately delivers no messages.
    onSendEmail: () => undefined,
    requireEmailVerification: false,
    passwordPolicy: { minLength: 12, checkBreaches: false },
  },
});

```

Important API details:

- `auth` is asynchronous and comes from `@absolutejs/auth/server`.
- `authSessionStore` is top-level. `credentialStore` and credential callbacks
  belong inside `credentials`. There is no top-level `sessionStore` option.
- Stores do not have `.runMigrations()`. Import `runMigrations` from the package
  root and supply its query client as shown above.
- With Drizzle 1's Bun driver use `drizzle({ client })`, not `drizzle(client)`.
- Keep `prepare: false` on the migration client only. Application queries need
  Bun's default prepared mode to encode JSON session data correctly.
- The built-in sign-out route is `DELETE /oauth2/signout`.
- Use `createAuthContext<Customer>({ authSessionStore: sessions })` from `/server` to read typed authenticated
  users. Business APIs must check the session server-side and scope records to
  that user. Do not implement a second password or cookie system.
- Preserve cookie headers when exposing a narrow typed JSON wrapper around the
  package's configurable credential routes. Never store session tokens in browser
  localStorage. Browser business requests belong in typed Eden + React Query.

## Typed credential routes (0.81.0+)

Use `createCredentialsApi` from `@absolutejs/auth/server` for fixed, directly
Eden-typed login, registration, verification and password-reset routes. Supply
application-owned credentials callbacks, cookie policy and a durable session
store. Mount this subapp instead of the `credentials` block on `auth`; keep
`auth` for OAuth/sign-out. No forwarding wrappers are needed.

The manifest tool `get_credentials_integration` returns the exact integration
source and required bindings. `credentialsConfiguration` is your application
module, not a package export: it supplies `authSessionStore`, `credentialStore`,
`getUserByEmail`, `onCreateCredentialUser`, and real `onSendEmail` delivery.
Configure trusted origins, verification and password policy. Never invent these
bindings, substitute in-memory production storage, or silently disable delivery.

Browser code imports only `typeof credentialsApi` and creates
`treaty<typeof credentialsApi>(origin)`. Call `client.auth.login.post(...)` in a
React Query `mutationFn`. Inspect errors and preserve `mfa_required` and
`verification_required` flows: a successful HTTP response does not always mean
an authenticated session.

For protected business routes use `createAuthContext({ authSessionStore })`,
read `absoluteAuthStatus.user`, return `status(401, { error: 'Sign in required' })`
when absent, and scope database access to that user. Export the narrow business
subapp type for its own Eden client inside React Query. A compiler pass is
necessary, but real signup, login, reset, authorization and persistence tests
are still required.
