import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type {
	PgAsyncDatabase,
	PgQueryResultHKT
} from 'drizzle-orm/pg-core';

// Shared scaffolding for the enterprise stores. Every new store ships an
// in-memory implementation (dev/test) plus a Postgres implementation that accepts
// a Drizzle `PgDatabase` — so it runs on Neon (neon-http) AND node-postgres without
// the package bundling a second driver. `createNeonDatabase` is the convenience
// wrapper consumers reach for when they just want a Neon connection string.

// PgAsyncDatabase (drizzle 1.0; was PgDatabase pre-1.0) is effectively invariant
// over its type parameters (query-result HKT, relational config), and TS can't
// reliably re-infer those base params from a concrete driver *subclass*
// (PostgresJsDatabase, NeonHttpDatabase, …). So the only way to accept any
// driver with NO caller-side cast is a generic store constructor whose db
// parameter is bound by `AnyPgDatabase`: `<DB extends AnyPgDatabase>(db: DB)`.
// The `any`s live ONLY in this bound — `DB` is inferred as the caller's exact
// database type, so store bodies stay fully typed (this is not `db: any`).
export type AnyPgDatabase = PgAsyncDatabase<PgQueryResultHKT>;

export const createNeonDatabase = (databaseUrl: string) =>
	drizzle({ client: neon(databaseUrl) });
