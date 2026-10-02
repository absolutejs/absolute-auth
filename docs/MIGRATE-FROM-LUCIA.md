# Migrating Lucia accounts to Absolute Auth

Keep one canonical application user and attach its login methods to that user.
Absolute Auth owns credential, identity and session storage; the application owns
its user/profile schema and the migration of business references.

## Preserve account ownership

Keep existing stable user IDs. If changing their type, build an explicit old-to-new
mapping and update all referencing rows in one transaction. Never merge accounts
because their emails match. Store imported password hashes in `auth_credentials`,
with `user_id` referencing the canonical user. Preserve the hash; configure a
password verifier for algorithms outside Bun's supported formats.

Use `createPostgresIdentityStore` for provider/subject ownership. Existing identity
rows must have the package's columns (`id`, `user_sub`, `auth_provider`,
`provider_subject`, `metadata`, timestamps). Migration block `identities` adds the
package columns and widens identity IDs to text. It does not create users or move
application-specific fields. Backfill display email/name into metadata explicitly.
For UUID application accounts, `defineAuthIdentitiesTable(() => users.id)` includes
the user foreign key in your Drizzle schema. Keep only one migration authority for
each table; applications with an existing journal should generate and review their
own cutover instead of applying two competing journals.

## Parse and validate exports

```sh
bunx absolute-auth import lucia ./export.json --db "$DATABASE_URL"
```

Dry-run parses users and identities and rejects duplicate source IDs, normalized
email collisions and orphan identities. It does not connect to or validate the
target database. Lucia email keys become password hashes; other provider keys
become identity records. Neither output constitutes a second user account.

Committed imports require an application adapter:

```sh
bunx absolute-auth import lucia ./export.json --db "$DATABASE_URL" \
  --writer ./scripts/write-auth-import.ts --commit
```

The module exports `writeAuthImport(result, { databaseUrl })` and returns
`{ userCount, identityCount }`. It must validate target constraints, transact the
whole import, preserve or explicitly map source IDs, insert credentials with the
canonical `user_id`, and link each identity to that ID. Keep source-to-target
mappings for idempotent retries; reject ownership collisions rather than silently
skipping users and attaching identities to guessed IDs. No default writer assumes
`users(sub, email, password)` or places passwords in a profile table.

## Switch sessions

Configure `createPostgresAuthSessionStore` as the same `authSessionStore` on OAuth,
credential routes, protected route reads, and signout. Read pending OAuth signup
through `loadUnregisteredSessionFromSource`; reading it as an authenticated session
can clear its cookie. `createAccountSession` rotates and revokes the prior session
and consumes the pending signup session.

Take a restorable backup and stop old writers before a schema-changing cutover.
Test existing passwords, OAuth login, explicit identity linking, signup rollback,
signout, expiry, and sessions across a fresh store/server instance. Restarting an
old in-memory implementation invalidates its sessions; users sign in once after
cutover. Database changes and application rollback must stay coordinated.
