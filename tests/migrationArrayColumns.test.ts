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

	test('casts empty PostgreSQL array defaults to the column type', () => {
		const sql = tablesToInitSql([
			pgTable('probe', {
				consumed: text('consumed').array().notNull().default([])
			})
		]);

		expect(sql).toContain(
			'"consumed" text[] NOT NULL DEFAULT ARRAY[]::text[]'
		);
		expect(sql).not.toContain("DEFAULT '[]'::jsonb");
	});

	test('renders populated and nested PostgreSQL array defaults', () => {
		const sql = tablesToInitSql([
			pgTable('probe', {
				grid: integer('grid')
					.array('[][]')
					.notNull()
					.default([
						[1, 2],
						[2, 1]
					]),
				labels: text('labels')
					.array()
					.notNull()
					.default(["owner's", 'custodian'])
			})
		]);

		expect(sql).toContain(
			'"grid" integer[][] NOT NULL DEFAULT ARRAY[ARRAY[1, 2], ARRAY[2, 1]]::integer[][]'
		);
		expect(sql).toContain(
			"\"labels\" text[] NOT NULL DEFAULT ARRAY['owner''s', 'custodian']::text[]"
		);
	});
});
