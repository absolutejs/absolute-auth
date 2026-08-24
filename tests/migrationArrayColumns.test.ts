import { describe, expect, test } from 'bun:test';
import { pgTable, text, integer } from 'drizzle-orm/pg-core';
import { tablesToInitSql } from '../src/migrations/generate';

/**
 * Drizzle 1.0 records array-ness as a dimension count on the column rather
 * than a distinct column class, and `getSQLType()` reports only the element
 * type. A generator that trusts it creates scalar columns for array fields --
 * which no migration rejects, because writing an array to a text column just
 * stringifies it to `{a,b}`. It reads back as a string and blows up somewhere
 * else entirely, so this is pinned here rather than left to integration luck.
 */
describe('array columns in generated DDL', () => {
	test('declares a text array as text[]', () => {
		const sql = tablesToInitSql([
			pgTable('probe', { scopes: text('scopes').array().notNull() })
		]);

		expect(sql).toContain('"scopes" text[] NOT NULL');
	});

	test('leaves scalar columns alone', () => {
		const sql = tablesToInitSql([
			pgTable('probe', { name: text('name').notNull() })
		]);

		expect(sql).toContain('"name" text NOT NULL');
		expect(sql).not.toContain('text[]');
	});

	test('carries the dimension count for nested arrays', () => {
		const sql = tablesToInitSql([
			pgTable('probe', { grid: integer('grid').array('[][]').notNull() })
		]);

		expect(sql).toContain('"grid" integer[][] NOT NULL');
	});
});
