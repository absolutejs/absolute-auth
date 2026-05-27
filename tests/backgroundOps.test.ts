import { describe, expect, mock, test } from 'bun:test';
import {
	pruneInactiveUsers,
	runEmailBreachScan
} from '../src/credentials/backgroundOps';

// `runEmailBreachScan` + `pruneInactiveUsers` are store-agnostic orchestrators — the
// consumer plugs in `iterateEmails` / `iterateUsers` (paged) and an event callback.
// These tests confirm the paging contract, the HIBP response handling (200/404/!ok),
// and the dryRun + missing-lastLogin paths for the pruner.

const MS_PER_DAY = 86_400_000;
const REF_NOW = 1_700_000_000_000;
const FRESH_DAYS = 5;
const STALE_DAYS = 200;
const VERY_OLD_DAYS = 400;
const ONE_DAY = 1;
const THRESHOLD_30_DAYS = 30;
const THRESHOLD_90_DAYS = 90;
const PAST_YEAR_DAYS = 365;
const HUNDRED_DAYS = 100;
const TWO_DAYS = 2;
const THREE_HUNDRED_DAYS = 300;
const FOUR_USERS = 4;
const THREE_USERS = 3;
const HTTP_404 = 404;
const HTTP_500 = 500;

const stubFetch = (handler: (url: string) => Response) =>
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test stub for fetch
	mock(async (input: RequestInfo | URL) =>
		handler(input.toString())
	) as unknown as typeof fetch;

const installFetch = (handler: (url: string) => Response) => {
	const original = globalThis.fetch;
	globalThis.fetch = stubFetch(handler);

	return () => {
		globalThis.fetch = original;
	};
};

describe('runEmailBreachScan', () => {
	test('reports breaches for emails that HIBP confirms and skips 404s', async () => {
		const restore = installFetch((url) => {
			if (url.includes('breached%40example.com')) {
				return new Response(
					JSON.stringify([{ addedDate: '2025-01-01', name: 'Adobe' }])
				);
			}

			return new Response(null, { status: HTTP_404 });
		});
		const events: string[] = [];
		const pages = [
			['safe@example.com', 'breached@example.com'],
			['also-safe@example.com']
		];
		let pageIndex = 0;
		const iterateEmails = async () => {
			const current = pageIndex;
			pageIndex += 1;
			if (current >= pages.length) {
				return { emails: [], nextCursor: undefined };
			}

			return {
				emails: pages[current] ?? [],
				nextCursor:
					current + 1 < pages.length ? String(current + 1) : undefined
			};
		};
		const result = await runEmailBreachScan({
			hibpApiKey: 'k',
			iterateEmails,
			pauseMs: 0,
			onBreachFound: (event) => {
				events.push(event.email);
			}
		});
		restore();

		expect(result.scanned).toBe(THREE_USERS);
		expect(result.breached).toBe(1);
		expect(events).toEqual(['breached@example.com']);
	});

	test('treats non-2xx HIBP responses as no-breach (fail-open)', async () => {
		const restore = installFetch(
			() => new Response(null, { status: HTTP_500 })
		);
		// eslint-disable-next-line absolute/no-useless-function -- callback signature requires a function
		const iterateEmails = async () => ({
			emails: ['a@b.com'],
			nextCursor: undefined
		});
		const onBreachFound = () => {
			throw new Error('should not fire');
		};
		const result = await runEmailBreachScan({
			hibpApiKey: 'k',
			iterateEmails,
			onBreachFound,
			pauseMs: 0
		});
		restore();
		expect(result).toEqual({ breached: 0, scanned: 1 });
	});
});

describe('pruneInactiveUsers', () => {
	test('selects users older than the threshold and calls onDelete', async () => {
		const deletions: string[] = [];
		// eslint-disable-next-line absolute/no-useless-function -- callback signature requires a function
		const iterateUsers = async () => ({
			nextCursor: undefined,
			users: [
				{ lastLoginAt: REF_NOW - STALE_DAYS * MS_PER_DAY, userId: 'stale' },
				{ lastLoginAt: REF_NOW - FRESH_DAYS * MS_PER_DAY, userId: 'fresh' },
				{
					createdAt: REF_NOW - VERY_OLD_DAYS * MS_PER_DAY,
					lastLoginAt: null,
					userId: 'never-logged-in-old'
				},
				{
					createdAt: REF_NOW - ONE_DAY * MS_PER_DAY,
					lastLoginAt: null,
					userId: 'never-logged-in-new'
				}
			]
		});
		const result = await pruneInactiveUsers({
			iterateUsers,
			olderThanDays: THRESHOLD_90_DAYS,
			now: () => REF_NOW,
			onDelete: (userId) => {
				deletions.push(userId);
			}
		});

		expect(result.scanned).toBe(FOUR_USERS);
		expect([...result.prunedUserIds].sort()).toEqual([
			'never-logged-in-old',
			'stale'
		]);
		expect([...deletions].sort()).toEqual([
			'never-logged-in-old',
			'stale'
		]);
	});

	test('dryRun reports candidates without calling onDelete', async () => {
		const deletions: string[] = [];
		// eslint-disable-next-line absolute/no-useless-function -- callback signature requires a function
		const iterateUsers = async () => ({
			nextCursor: undefined,
			users: [
				{
					lastLoginAt: REF_NOW - PAST_YEAR_DAYS * MS_PER_DAY,
					userId: 'stale'
				}
			]
		});
		const result = await pruneInactiveUsers({
			dryRun: true,
			iterateUsers,
			olderThanDays: THRESHOLD_30_DAYS,
			now: () => REF_NOW,
			onDelete: (userId) => {
				deletions.push(userId);
			}
		});

		expect(result.dryRun).toBe(true);
		expect(result.prunedUserIds).toEqual(['stale']);
		expect(deletions).toEqual([]);
	});

	test('walks every page via the cursor contract', async () => {
		const pageData = [
			[{ lastLoginAt: REF_NOW - HUNDRED_DAYS * MS_PER_DAY, userId: 'a' }],
			[{ lastLoginAt: REF_NOW - TWO_DAYS * MS_PER_DAY, userId: 'b' }],
			[
				{
					lastLoginAt: REF_NOW - THREE_HUNDRED_DAYS * MS_PER_DAY,
					userId: 'c'
				}
			]
		];
		const seenCursors: Array<string | undefined> = [];
		const iterateUsers = async (cursor: string | undefined) => {
			seenCursors.push(cursor);
			const index = cursor === undefined ? 0 : Number(cursor);
			const users = pageData[index] ?? [];
			const nextCursor =
				index + 1 < pageData.length ? String(index + 1) : undefined;

			return { nextCursor, users };
		};
		const result = await pruneInactiveUsers({
			iterateUsers,
			olderThanDays: THRESHOLD_30_DAYS,
			now: () => REF_NOW,
			onDelete: () => {
				/* noop */
			}
		});

		expect(seenCursors).toEqual([undefined, '1', '2']);
		expect(result.scanned).toBe(THREE_USERS);
		expect([...result.prunedUserIds].sort()).toEqual(['a', 'c']);
	});
});
