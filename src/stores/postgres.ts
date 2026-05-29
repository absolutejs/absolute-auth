import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

// Shared scaffolding for the enterprise stores. Every new store ships an
// in-memory implementation (dev/test) plus a Postgres implementation that accepts
// a Drizzle `PgDatabase` — so it runs on Neon (neon-http) AND node-postgres without
// the package bundling a second driver. `createNeonDatabase` is the convenience
// wrapper consumers reach for when they just want a Neon connection string.

// Generic over the driver's query-result HKT. PgDatabase is effectively
// invariant over that HKT, so pinning a concrete one (the old
// `PgDatabase<PgQueryResultHKT>`) rejected postgres-js / node-postgres
// instances and forced consumers to cast. Threading the HKT as a type
// parameter on each store constructor lets every driver's db bind by inference
// — no `any`, no caller-side casts, and the store bodies stay fully typed.
export type AnyPgDatabase<Q extends PgQueryResultHKT = PgQueryResultHKT> =
	PgDatabase<Q>;

// Re-exported so each store can bound its constructor's `Q` from one import.
export type { PgQueryResultHKT } from 'drizzle-orm/pg-core';

export const createNeonDatabase = (databaseUrl: string) =>
	drizzle(neon(databaseUrl));
