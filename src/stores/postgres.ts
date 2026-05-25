import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

// Shared scaffolding for the enterprise stores. Every new store ships an
// in-memory implementation (dev/test) plus a Postgres implementation that accepts
// a Drizzle `PgDatabase` — so it runs on Neon (neon-http) AND node-postgres without
// the package bundling a second driver. `createNeonDatabase` is the convenience
// wrapper consumers reach for when they just want a Neon connection string.

export type AnyPgDatabase = PgDatabase<PgQueryResultHKT>;

export const createNeonDatabase = (databaseUrl: string) =>
	drizzle(neon(databaseUrl));
