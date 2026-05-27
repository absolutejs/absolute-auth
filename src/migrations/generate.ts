// Translate the package's existing `pgTable` definitions into `CREATE TABLE IF NOT EXISTS`
// SQL, so each block's migration is derived from the same drizzle schema the runtime store
// already uses. Eliminates the transcription-drift risk of hand-writing CREATE TABLEs that
// have to stay in sync with the table definitions in `src/<block>/postgresStores.ts`.
//
// What this covers: column name + type + nullability + default + primary key + unique +
// composite primary key. Doesn't cover: foreign keys (none of the package's tables use
// them across blocks — sub-keys are referenced by id without referential integrity),
// indices (consumers can add their own per their workload), check constraints (none in
// the schema). If a block ever needs any of those, hand-write that migration entry
// alongside the auto-generated one.

import { is, SQL } from 'drizzle-orm';
import {
	getTableConfig,
	type PgColumn,
	type PgTable
} from 'drizzle-orm/pg-core';

// Defaults declared with drizzle's `sql\`...\`` template are `SQL` objects; render them as
// raw SQL expressions (e.g. `now()`) instead of letting them fall into the generic-object
// JSON branch, which would emit a `{"queryChunks":[...]}::jsonb` literal.
const renderChunk = (chunk: unknown) => {
	if (chunk === null || typeof chunk !== 'object') return String(chunk);
	const value = Reflect.get(chunk, 'value');
	if (Array.isArray(value)) return value.map((part) => String(part)).join('');

	return '';
};

const formatSqlTemplate = (value: SQL) =>
	value.queryChunks.map(renderChunk).join('');

const formatDefault = (value: unknown) => {
	if (value === null || value === undefined) return 'NULL';
	if (is(value, SQL)) return formatSqlTemplate(value);
	if (typeof value === 'string') return `'${value.replace(/'/gu, "''")}'`;
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') return String(value);
	if (Array.isArray(value) || typeof value === 'object') {
		return `'${JSON.stringify(value)}'::jsonb`;
	}

	return String(value);
};

const columnSql = (column: PgColumn) => {
	const parts = [`"${column.name}"`, column.getSQLType()];
	if (column.primary) parts.push('PRIMARY KEY');
	if (column.notNull && !column.primary) parts.push('NOT NULL');
	if (column.hasDefault && column.default !== undefined) {
		parts.push(`DEFAULT ${formatDefault(column.default)}`);
	}
	if (column.isUnique) parts.push('UNIQUE');

	return parts.join(' ');
};

const compositePkLine = (compositePk: readonly PgColumn[]) =>
	`PRIMARY KEY (${compositePk.map((column) => `"${column.name}"`).join(', ')})`;

// Emit a single `CREATE TABLE IF NOT EXISTS` for one table. Idempotent — re-running is a
// no-op even when the consumer already wired the table by hand. The composite-PK case is
// handled separately because Drizzle splits it out of the column metadata.
const tableToCreateSql = (table: PgTable) => {
	const cfg = getTableConfig(table);
	const columnLines = cfg.columns.map(columnSql);
	const singlePk = cfg.columns.find((column) => column.primary);
	const compositePk = cfg.primaryKeys[0]?.columns ?? [];
	const lines =
		singlePk === undefined && compositePk.length > 0
			? [...columnLines, compositePkLine(compositePk)]
			: columnLines;
	const body = lines.map((line) => `\t${line}`).join(',\n');

	return `CREATE TABLE IF NOT EXISTS "${cfg.name}" (\n${body}\n);`;
};

// Block migrations are always declared as one `0001_init` covering every table the block
// owns + (rare) hand-written follow-up ids for schema changes. This helper does the init
// step — pass every table you want included.
export const tablesToInitSql = (tables: PgTable[]) =>
	tables.map(tableToCreateSql).join('\n\n');
