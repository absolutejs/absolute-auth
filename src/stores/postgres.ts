import type {
	ExtractTablesWithRelations,
	TablesRelationalConfig
} from 'drizzle-orm';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

// Shared scaffolding for the enterprise stores. Every new store ships an
// in-memory implementation (dev/test) plus a Postgres implementation that accepts
// a Drizzle `PgDatabase` — so it runs on Neon (neon-http) AND node-postgres without
// the package bundling a second driver. `createNeonDatabase` is the convenience
// wrapper consumers reach for when they just want a Neon connection string.

// Generic over all three `PgDatabase` type parameters (query-result HKT, full
// schema, relational schema). PgDatabase is effectively invariant over these,
// so pinning concrete ones (the old `PgDatabase<PgQueryResultHKT>`) rejected
// postgres-js / node-postgres instances and forced consumers to cast. By
// threading them as type parameters on each store constructor, TS *infers* the
// caller's exact db type (unification, not a supertype check) — so every
// driver binds with no `any`, no caller-side casts, and fully-typed store
// bodies.
export type AnyPgDatabase<
	Q extends PgQueryResultHKT = PgQueryResultHKT,
	TFullSchema extends Record<string, unknown> = Record<string, never>,
	TSchema extends
		TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>
> = PgDatabase<Q, TFullSchema, TSchema>;

// Re-exported so each store can bound its constructor generics from one import.
export type { PgQueryResultHKT } from 'drizzle-orm/pg-core';
export type { TablesRelationalConfig } from 'drizzle-orm';

export const createNeonDatabase = (databaseUrl: string) =>
	drizzle(neon(databaseUrl));
