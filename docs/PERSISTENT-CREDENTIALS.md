# Persistent email/password sign-in (Bun + Elysia 2)

Email/password accounts whose users and sessions survive a restart. Written
against `@absolutejs/auth` 0.94.0. Every TypeScript block below that names a
file is extracted and typechecked against the package's published types by
`bun run check:guide`, so the code here is code that compiles.

Pick one path and follow it top to bottom:

- [PostgreSQL + Drizzle](#postgresql--drizzle): the package ships the stores
  and the migrations. Use this for anything real.
- [SQLite (`bun:sqlite`)](#sqlite-bunsqlite): the package ships **no** SQLite
  store and no SQLite migrations. You implement the two small store
  interfaces yourself; a complete implementation is below.

Do not combine them (for example Postgres for auth and SQLite for users).

## Who owns what

| Data                                 | Owner       | Where                                                                                                          |
| ------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------- |
| Users (id, email, profile)           | Your app    | Your own table, read through `getUserByEmail` and created in `onCreateCredentialUser`                          |
| Password hashes, verify/reset tokens | The package | `CredentialStore` (`auth_credentials`, `auth_credential_reset_tokens`, `auth_credential_verification_tokens`) |
| Sessions                             | The package | `AuthSessionStore` (`auth_sessions`, `auth_unregistered_sessions`)                                             |

The session stores a snapshot of your user (the value `onCreateCredentialUser`
or `getUserByEmail` returned) as JSON. Keep that type small and JSON-safe; it
is what protected routes receive.

### Supported stores

| Store                  | Sessions                                     | Credentials                                 | Migrations                          |
| ---------------------- | -------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| PostgreSQL via Drizzle | `createPostgresAuthSessionStore(db, decode)` | `createPostgresCredentialStore(db)`         | Shipped (`runBunMigrations`, CLI)   |
| Neon HTTP              | `createNeonAuthSessionStore(url, decode)`    | `createNeonCredentialStore(url)`            | Shipped                             |
| Redis                  | `createRedisAuthSessionStore(...)`           | none: pair with a Postgres credential store | none needed for sessions            |
| In memory              | `createInMemoryAuthSessionStore()`           | `createInMemoryCredentialStore()`           | none; everything is lost on restart |
| SQLite                 | your `AuthSessionStore` (below)              | your `CredentialStore` (below)              | yours                               |

`createPostgresAuthSessionStore` and `createPostgresCredentialStore` accept any
Drizzle 1 Postgres database (Bun SQL, node-postgres, postgres.js, Neon). All
store factories are exported from `@absolutejs/auth`.

## The HTTP contract

`createCredentialsApi` (from `@absolutejs/auth/server`) mounts fixed paths, so
Eden infers every route and body. `createSignoutApi` mounts sign-out.

| Method + path                       | Body                                               | Success                                                                     | Failures                                                                                                  |
| ----------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `POST /auth/register`               | `{ email, password }` plus any extra signup fields | `201 { status: 'authenticated' }` and a session cookie                      | `400` invalid email or weak password (`{ message, violations }`), `403` untrusted origin                 |
| `POST /auth/login`                  | `{ email, password }`                              | `200 { status: 'authenticated', passwordCompromised }` and a session cookie | `401` wrong email or password, `403 { status: 'email_not_verified' }`, `429 { status: 'account_locked' }` |
| `POST /auth/verify-email`           | `{ token }`                                        | `200 { status: 'email_verified' }` (does not sign in)                       | `400` invalid or expired token                                                                            |
| `POST /auth/verify-email/request`   | `{ email }`                                        | `200 { status: 'verification_requested' }` whether or not the email exists  |                                                                                                           |
| `POST /auth/reset-password/request` | `{ email }`                                        | `200 { status: 'reset_requested' }` whether or not the email exists         |                                                                                                           |
| `POST /auth/reset-password`         | `{ token, password }`                              | `200 { status: 'password_reset' }`                                          | `400` invalid token or weak password                                                                      |
| `DELETE /oauth2/signout`            | none (reads the cookie)                            | `204`, session removed, cookie cleared                                      | `401` no session cookie                                                                                   |

Tokens for the two `/request` routes and for registration are handed to your
`onSendEmail` callback; the package never sends email itself.

Things that trip people up:

- Registering an email that already exists answers
  `201 { status: 'verification_required' }` and signs nobody in (no account
  enumeration). So does every registration when `requireEmailVerification: true`.
  Treat "is there a session" as a separate question (`GET /api/me` below)
  instead of trusting the register response.
- `POST /auth/login` answers `200 { status: 'mfa_required' }` when you
  configure `isMfaRequired`. A `200` alone does not mean signed in; check
  `status === 'authenticated'`.
- The sign-out path is `DELETE /oauth2/signout`, also for credentials-only apps.

### The session cookie

- Name: **`user_session_id`**. Value: a UUID naming a row in the session store.
- `HttpOnly`, `SameSite=Lax`, `Path=/`.
- `Secure` unless `NODE_ENV` is `development` or `test`; override with
  `cookieSecure`.
- A browser-session cookie (no `Max-Age`): it ends when the browser closes.
  On the server the session expires after `sessionDurationMs` (default 24
  hours).

Never copy the session id into `localStorage` or a response body.

## PostgreSQL + Drizzle

Install, and set `DATABASE_URL` to a real PostgreSQL database:

```sh
bun add @absolutejs/auth elysia@2.0.0-beta.6 drizzle-orm@1.0.0-rc.4 @elysia/eden@2.0.0-beta.5
```

### 1. Database client and your users table

```ts file=postgres/db.ts
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

// Drizzle 1 takes the client as an option: drizzle({ client }), not drizzle(client).
export const db = drizzle({ client: new SQL(databaseUrl) });

/** App-owned accounts. Password hashes and sessions live in the package's auth_* tables. */
export const users = pgTable('users', {
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.defaultNow(),
	email: text('email').notNull().unique(),
	id: text('id').primaryKey()
});
```

Create `users` with your normal Drizzle migrations (see
[Migrations](#5-migrations)).

### 2. Auth: migrations, stores, routes and the guard

```ts file=postgres/auth.ts
import {
	createPostgresAuthSessionStore,
	createPostgresCredentialStore
} from '@absolutejs/auth';
import { runBunMigrations } from '@absolutejs/auth/bun';
import {
	createAuthContext,
	createCredentialsApi,
	createSignoutApi
} from '@absolutejs/auth/server';
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { db, users } from './db';

/** What the session stores and what protected routes receive. Keep it JSON-safe. */
export type SessionUser = { email: string; id: string };

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set');

// Creates or upgrades auth_sessions, auth_unregistered_sessions and the three
// auth_credential* tables. Idempotent, serialized with an advisory lock and
// journaled in auth_migrations, so it is safe on every boot and every replica.
await runBunMigrations({
	blocks: ['sessions', 'credentials'],
	databaseUrl,
	log: () => undefined
});

/** Sessions come back from the database as JSON: decode, never cast. */
const decodeSessionUser = (value: unknown): SessionUser => {
	if (typeof value !== 'object' || value === null)
		throw new Error('Invalid session user');
	const id: unknown = Reflect.get(value, 'id');
	const email: unknown = Reflect.get(value, 'email');
	if (typeof id !== 'string' || typeof email !== 'string')
		throw new Error('Invalid session user');

	return { email, id };
};

export const authSessionStore = createPostgresAuthSessionStore(
	db,
	decodeSessionUser
);

const sessionUser = { email: users.email, id: users.id };

/** POST /auth/register, /auth/login, /auth/verify-email(/request), /auth/reset-password(/request). */
export const credentialsApi = createCredentialsApi<SessionUser>({
	authSessionStore,
	credentialStore: createPostgresCredentialStore(db),
	getUserByEmail: async (email) => {
		const [user] = await db
			.select(sessionUser)
			.from(users)
			.where(eq(users.email, email));

		return user ?? null;
	},
	onCreateCredentialUser: async ({ email }) => {
		const [user] = await db
			.insert(users)
			.values({ email, id: crypto.randomUUID() })
			.returning(sessionUser);
		if (!user) throw new Error('User insert failed');

		return user;
	},
	// Receives verify_email and reset_password tokens. Wire real email delivery
	// before offering password reset. Never log the token and never throw:
	// the user already exists when a registration email is sent.
	onSendEmail: ({ type }) => {
		console.warn(`[auth] ${type} email not sent: no delivery configured`);
	},
	passwordPolicy: { minLength: 12 },
	requireEmailVerification: false
});

/** DELETE /oauth2/signout: removes the session row and clears the cookie. */
export const signoutApi = createSignoutApi({ authSessionStore });

/** Reads the user_session_id cookie into absoluteAuthStatus. */
export const authContext = createAuthContext<SessionUser>({
	authSessionStore
});

/** Routes registered after `.use(requireUser)` receive a typed `user`; without a session they answer 401. */
export const requireUser = new Elysia({ name: 'require-user' })
	.use(authContext)
	.derive('plugin', ({ absoluteAuthStatus, status }) =>
		absoluteAuthStatus.user
			? { user: absoluteAuthStatus.user }
			: status(401, { error: 'Sign in required' })
	);
```

### 3. Protected routes and the server

```ts file=postgres/app.ts
import { Elysia } from 'elysia';
import { credentialsApi, requireUser, signoutApi } from './auth';

/** Signed-in routes: the user comes from the session, never from the request. */
export const accountApi = new Elysia({ name: 'account-api' })
	.use(requireUser)
	.get('/api/me', ({ user }) => ({ user }));

export const app = new Elysia()
	.use(credentialsApi)
	.use(signoutApi)
	.use(accountApi);
```

```ts file=postgres/server.ts
import { app } from './app';

app.listen(Number(process.env.PORT ?? 3000));
```

Scope every business query by `user.id` from the guard. A route with a body
schema takes the options before the handler in Elysia 2:
`.post('/api/notes', { body: t.Object({ text: t.String() }) }, ({ body, user }) => ...)`.

### 4. Browser client

One directly typed Eden client per subapp. Run these calls inside React Query
`queryFn`/`mutationFn` (or your framework's equivalent). The browser sends the
`user_session_id` cookie on same-origin requests by itself.

```ts file=postgres/client.ts
import { treaty } from '@elysia/eden';
import type { accountApi } from './app';
import type { credentialsApi, signoutApi } from './auth';

const origin = window.location.origin;

export const credentialsClient = treaty<typeof credentialsApi>(origin);
export const signoutClient = treaty<typeof signoutApi>(origin);
export const accountClient = treaty<typeof accountApi>(origin);

export const register = async (email: string, password: string) => {
	const { error } = await credentialsClient.auth.register.post({
		email,
		password
	});
	if (error) throw new Error('Sign-up failed');
};

export const signIn = async (email: string, password: string) => {
	const { data, error } = await credentialsClient.auth.login.post({
		email,
		password
	});
	if (error) throw new Error('Wrong email or password');
	if (data.status !== 'authenticated')
		throw new Error('This account needs another verification step');
};

/** The signed-in user, or null after a 401. */
export const currentUser = async () => {
	const { data, error, status } = await accountClient.api.me.get();
	if (status === 401) return null;
	if (error) throw new Error('Could not load the account');

	return data.user;
};

export const signOut = async () => {
	const { error } = await signoutClient.oauth2.signout.delete();
	if (error) throw new Error('Sign-out failed');
};
```

### 5. Migrations

The package owns the DDL for its `auth_*` tables. Do not write those tables
yourself and do not generate them with drizzle-kit. Use one of:

- **At boot, on Bun** (shown above): `runBunMigrations({ databaseUrl, blocks })`
  from `@absolutejs/auth/bun`. It opens and closes its own connection.
- **From the CLI**, for example in a deploy step:

  ```sh
  bunx absolute-auth migrate --db "$DATABASE_URL" --blocks sessions,credentials
  ```

- **With a client you already hold** (node-postgres, a pool):
  `runMigrations({ client, blocks })` from `@absolutejs/auth`, where `client`
  has `query(text, values) => Promise<{ rows }>`.

For credentials you need the `sessions` and `credentials` blocks. Add others
(`mfa`, `lockout`, `webauthn`, ...) when you enable those features. Applied
migrations are recorded in `auth_migrations`: re-running is a no-op, and a
package upgrade that adds a migration applies it on the next run.

Your own tables (`users` above) use your normal Drizzle workflow. When
drizzle-kit manages the same database, keep it away from the package's
tables with `tablesFilter`:

```ts unchecked
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/db.ts',
	tablesFilter: ['!auth_*']
});
```

## SQLite (`bun:sqlite`)

The package has no SQLite adapter. The two store interfaces are small, so a
complete implementation is here. Rows are JSON; the session user is decoded on
read, as the Postgres store does it.

### 1. Database, your users table and the auth tables

```ts file=sqlite/db.ts
import { Database } from 'bun:sqlite';

// Put the file on a persistent volume: inside a container's writable layer it
// is lost on redeploy. The directory must exist.
export const db = new Database(process.env.SQLITE_PATH ?? 'data/app.sqlite', {
	create: true,
	strict: true
});

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL UNIQUE,
	created_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
	id TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	data TEXT NOT NULL,
	expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at_ms);
CREATE TABLE IF NOT EXISTS auth_credentials (
	email TEXT PRIMARY KEY,
	data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_credential_tokens (
	token_hash TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	email TEXT NOT NULL,
	expires_at_ms INTEGER NOT NULL
);
`);
```

### 2. The stores

```ts file=sqlite/stores.ts
import type {
	AuthSessionStore,
	CredentialRecord,
	CredentialStore,
	CredentialToken,
	SessionUserDecoder
} from '@absolutejs/auth';
import type { Database } from 'bun:sqlite';

type SessionKind = 'registered' | 'unregistered';
type TokenKind = 'reset' | 'verify';
type DataRow = { data: string };
type TokenRow = { email: string; expires_at_ms: number; token_hash: string };

const parseObject = (text: string) => {
	const value: unknown = JSON.parse(text);
	if (typeof value !== 'object' || value === null)
		throw new Error('Corrupt auth row');

	return value;
};

const readExpiry = (value: object) => {
	const expiresAt: unknown = Reflect.get(value, 'expiresAt');
	if (typeof expiresAt !== 'number') throw new Error('Corrupt auth row');

	return expiresAt;
};

export const createSqliteAuthSessionStore = <UserType>(
	db: Database,
	decodeUser: SessionUserDecoder<UserType>
): AuthSessionStore<UserType> => {
	const select = db.query<DataRow, [string, SessionKind]>(
		'SELECT data FROM auth_sessions WHERE id = ? AND kind = ?'
	);
	const upsert = db.query<unknown, [string, SessionKind, string, number]>(
		'INSERT INTO auth_sessions (id, kind, data, expires_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, data = excluded.data, expires_at_ms = excluded.expires_at_ms'
	);
	const remove = db.query<unknown, [string, SessionKind]>(
		'DELETE FROM auth_sessions WHERE id = ? AND kind = ?'
	);
	const removeExpired = db.query<unknown, [SessionKind, number]>(
		'DELETE FROM auth_sessions WHERE kind = ? AND expires_at_ms < ?'
	);
	const read = (id: string, kind: SessionKind) => {
		const row = select.get(id, kind);

		return row ? parseObject(row.data) : undefined;
	};

	return {
		deleteExpired: async () =>
			removeExpired.run('registered', Date.now()).changes,
		deleteExpiredUnregistered: async () =>
			removeExpired.run('unregistered', Date.now()).changes,
		getSession: async (id) => {
			const value = read(id, 'registered');
			if (!value) return undefined;

			return {
				...value,
				expiresAt: readExpiry(value),
				user: decodeUser(Reflect.get(value, 'user'))
			};
		},
		getUnregisteredSession: async (id) => {
			const value = read(id, 'unregistered');

			return value ? { ...value, expiresAt: readExpiry(value) } : undefined;
		},
		removeSession: async (id) => {
			remove.run(id, 'registered');
		},
		removeUnregisteredSession: async (id) => {
			remove.run(id, 'unregistered');
		},
		setSession: async (id, value) => {
			upsert.run(id, 'registered', JSON.stringify(value), value.expiresAt);
		},
		setUnregisteredSession: async (id, value) => {
			upsert.run(
				id,
				'unregistered',
				JSON.stringify(value),
				value.expiresAt
			);
		}
	};
};

const decodeCredential = (text: string): CredentialRecord => {
	const value = parseObject(text);
	const email: unknown = Reflect.get(value, 'email');
	const passwordHash: unknown = Reflect.get(value, 'passwordHash');
	const emailVerified: unknown = Reflect.get(value, 'emailVerified');
	const createdAt: unknown = Reflect.get(value, 'createdAt');
	const updatedAt: unknown = Reflect.get(value, 'updatedAt');
	const status: unknown = Reflect.get(value, 'status');
	const userId: unknown = Reflect.get(value, 'userId');
	const organizationId: unknown = Reflect.get(value, 'organizationId');
	const registrationData: unknown = Reflect.get(value, 'registrationData');
	if (
		typeof email !== 'string' ||
		typeof passwordHash !== 'string' ||
		typeof emailVerified !== 'boolean' ||
		typeof createdAt !== 'number' ||
		typeof updatedAt !== 'number'
	)
		throw new Error('Corrupt credential row');

	return {
		createdAt,
		email,
		emailVerified,
		organizationId:
			typeof organizationId === 'string' ? organizationId : undefined,
		passwordHash,
		registrationData:
			typeof registrationData === 'object' && registrationData !== null
				? { ...registrationData }
				: undefined,
		status: status === 'disabled' ? 'disabled' : 'active',
		updatedAt,
		userId: typeof userId === 'string' ? userId : undefined
	};
};

export const createSqliteCredentialStore = (db: Database): CredentialStore => {
	const selectCredential = db.query<DataRow, [string]>(
		'SELECT data FROM auth_credentials WHERE email = ?'
	);
	const upsertCredential = db.query<unknown, [string, string]>(
		'INSERT INTO auth_credentials (email, data) VALUES (?, ?) ON CONFLICT (email) DO UPDATE SET data = excluded.data'
	);
	const upsertToken = db.query<unknown, [string, TokenKind, string, number]>(
		'INSERT INTO auth_credential_tokens (token_hash, kind, email, expires_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT (token_hash) DO UPDATE SET kind = excluded.kind, email = excluded.email, expires_at_ms = excluded.expires_at_ms'
	);
	// Single use: the row is deleted whether or not it has expired.
	const deleteToken = db.query<TokenRow, [string, TokenKind]>(
		'DELETE FROM auth_credential_tokens WHERE token_hash = ? AND kind = ? RETURNING token_hash, email, expires_at_ms'
	);

	const getCredential = (email: string) => {
		const row = selectCredential.get(email.toLowerCase());

		return row ? decodeCredential(row.data) : undefined;
	};
	const saveCredential = (credential: CredentialRecord) => {
		const email = credential.email.toLowerCase();
		upsertCredential.run(email, JSON.stringify({ ...credential, email }));
	};
	const saveToken = (kind: TokenKind, token: CredentialToken) => {
		upsertToken.run(
			token.tokenHash,
			kind,
			token.email.toLowerCase(),
			token.expiresAt
		);
	};
	const consumeToken = (kind: TokenKind, tokenHash: string) => {
		const row = deleteToken.get(tokenHash, kind);
		if (!row || row.expires_at_ms < Date.now()) return undefined;

		return {
			email: row.email,
			expiresAt: row.expires_at_ms,
			tokenHash: row.token_hash
		};
	};

	return {
		consumeResetToken: async (tokenHash) => consumeToken('reset', tokenHash),
		consumeVerificationToken: async (tokenHash) =>
			consumeToken('verify', tokenHash),
		getCredentialByEmail: async (email) => getCredential(email),
		saveCredential: async (credential) => saveCredential(credential),
		saveResetToken: async (token) => saveToken('reset', token),
		saveVerificationToken: async (token) => saveToken('verify', token),
		setEmailVerified: async (email) => {
			const credential = getCredential(email);
			if (credential)
				saveCredential({
					...credential,
					emailVerified: true,
					updatedAt: Date.now()
				});
		}
	};
};
```

### 3. Auth, routes and the guard

The same as the Postgres path except for the stores and the user queries.

```ts file=sqlite/auth.ts
import {
	createAuthContext,
	createCredentialsApi,
	createSignoutApi
} from '@absolutejs/auth/server';
import { Elysia } from 'elysia';
import { db } from './db';
import {
	createSqliteAuthSessionStore,
	createSqliteCredentialStore
} from './stores';

export type SessionUser = { email: string; id: string };

const decodeSessionUser = (value: unknown): SessionUser => {
	if (typeof value !== 'object' || value === null)
		throw new Error('Invalid session user');
	const id: unknown = Reflect.get(value, 'id');
	const email: unknown = Reflect.get(value, 'email');
	if (typeof id !== 'string' || typeof email !== 'string')
		throw new Error('Invalid session user');

	return { email, id };
};

const userByEmail = db.query<SessionUser, [string]>(
	'SELECT id, email FROM users WHERE email = ?'
);
const insertUser = db.query<unknown, [string, string, number]>(
	'INSERT INTO users (id, email, created_at_ms) VALUES (?, ?, ?)'
);

export const authSessionStore = createSqliteAuthSessionStore(
	db,
	decodeSessionUser
);

export const credentialsApi = createCredentialsApi<SessionUser>({
	authSessionStore,
	credentialStore: createSqliteCredentialStore(db),
	getUserByEmail: (email) => userByEmail.get(email),
	onCreateCredentialUser: ({ email }) => {
		const user = { email, id: crypto.randomUUID() };
		insertUser.run(user.id, user.email, Date.now());

		return user;
	},
	onSendEmail: ({ type }) => {
		console.warn(`[auth] ${type} email not sent: no delivery configured`);
	},
	passwordPolicy: { minLength: 12 },
	requireEmailVerification: false
});

export const signoutApi = createSignoutApi({ authSessionStore });

export const authContext = createAuthContext<SessionUser>({
	authSessionStore
});

export const requireUser = new Elysia({ name: 'require-user' })
	.use(authContext)
	.derive('plugin', ({ absoluteAuthStatus, status }) =>
		absoluteAuthStatus.user
			? { user: absoluteAuthStatus.user }
			: status(401, { error: 'Sign in required' })
	);
```

```ts file=sqlite/app.ts
import { Elysia } from 'elysia';
import { credentialsApi, requireUser, signoutApi } from './auth';

export const accountApi = new Elysia({ name: 'account-api' })
	.use(requireUser)
	.get('/api/me', ({ user }) => ({ user }));

export const app = new Elysia()
	.use(credentialsApi)
	.use(signoutApi)
	.use(accountApi);
```

Start it with `app.listen(...)` as in the Postgres `server.ts`. The browser
client is the same as the [Postgres one](#4-browser-client).

### SQLite migrations

There is nothing to run: the `CREATE TABLE IF NOT EXISTS` statements in
`db.ts` are the whole schema. `absolute-auth migrate` and `runBunMigrations`
are PostgreSQL only. When you change these tables later, version the change
yourself (for example with `PRAGMA user_version`). Package upgrades cannot
change this schema because the package never reads it; they can only change
the store interfaces, and the compiler reports that.

## Corrections to earlier versions of this guide

- It mixed both databases in one program: Postgres for auth and a `bun:sqlite`
  file for users. Each path above uses one database.
- It said to import `runMigrations` from the package root and keep a
  `prepare: false` migration client, while its own code called
  `runBunMigrations`. On Bun use `runBunMigrations` from `@absolutejs/auth/bun`
  (0.83.0+), which owns its connection and takes a lock; `runMigrations({ client })`
  is for a Postgres client you already hold.
- It led with `auth({ credentials })`. That still works when you also need
  OAuth, but for email/password use `createCredentialsApi` (0.81.0+) and
  `createSignoutApi` (0.82.0+), which Eden types directly. When you mount full
  `auth` for OAuth as well, it already serves `DELETE /oauth2/signout`; do not
  mount `createSignoutApi` a second time.
- The package manifest's `get_credentials_integration` tool returns the same
  wiring and expects a `credentialsConfiguration` module that you write. The
  `auth.ts` files above are that module, filled in for each database.

Stores have no `.runMigrations()` method, and there is no top-level
`sessionStore` option: the store is `authSessionStore`.
