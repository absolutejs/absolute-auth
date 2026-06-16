// Two background-ops orchestrators that solve operational gaps every auth deployment
// hits at scale but no one writes from scratch correctly:
//
//   1) `runEmailBreachScan` re-scans existing user emails against HaveIBeenPwned's
//      breached-account database. Passwords are checked at login (`isPasswordCompromised`);
//      this is the email counterpart — run it on a cron and you'll catch breaches that
//      happen after a user signed up. Requires an HIBP API key (the email endpoint is
//      paid, unlike the k-anonymity password range API).
//
//   2) `pruneInactiveUsers` walks a user population, finds anyone whose last login is
//      older than the threshold, and lets you delete or disable them. Pure orchestrator —
//      the consumer supplies `iterateUsers` (so we don't need to know your user table
//      shape) and `onDelete` (so you decide soft-delete vs hard-delete vs notify-only).
//
// Both functions are store-agnostic. We don't add list/iterate methods to `CredentialStore`
// because the consumer's user table is the source of truth for "who exists" and "when did
// they last log in" — credentials are auth material, not the user registry.

const HIBP_BREACHED_ACCOUNT_URL =
	'https://haveibeenpwned.com/api/v3/breachedaccount/';
const HIBP_USER_AGENT = '@absolutejs/auth breach scanner';
const DEFAULT_PAUSE_MS = 1700;
const HIBP_NOT_FOUND = 404;
const HIBP_RATE_LIMITED = 429;
const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1000;

export type BreachRecord = {
	addedDate: string;
	dataClasses?: string[];
	name: string;
};

export type EmailBreachEvent = {
	breaches: BreachRecord[];
	email: string;
};

export type EmailBreachScanInput = {
	hibpApiKey: string;
	// Cursor-based pager. Return `nextCursor: undefined` to stop. The pager owns its own
	// batching — typical implementations select N rows, return them as `emails`, and pass
	// the last row's id back as `nextCursor`.
	iterateEmails: (
		cursor: string | undefined
	) => Promise<{ emails: string[]; nextCursor: string | undefined }>;
	// Called once per email with at least one breach hit. Returning a rejected promise will
	// abort the scan — wrap your own writes in try/catch if you want to keep going.
	onBreachFound: (event: EmailBreachEvent) => Promise<void> | void;
	// HIBP's documented rate limit is one request per ~1.5s on the cheapest tier. We default
	// to 1700ms; override if you have a higher tier or are sharing the budget.
	pauseMs?: number;
	// Set to true to ask HIBP for `truncateResponse=false` (returns the full breach object
	// with `dataClasses`). Costs more bandwidth; default false matches HIBP's default.
	truncateResponse?: boolean;
};

export type EmailBreachScanResult = {
	breached: number;
	scanned: number;
};

const sleep = (delayMs: number) =>
	// eslint-disable-next-line promise/avoid-new -- minimal sleep helper; setTimeout has no Promise-returning alternative
	new Promise<void>((resolve) => {
		setTimeout(resolve, delayMs);
	});

const isBreachRecord = (entry: unknown): entry is BreachRecord => {
	if (typeof entry !== 'object' || entry === null) return false;
	if (!('name' in entry)) return false;
	const candidate: { name?: unknown } = entry;

	return typeof candidate.name === 'string';
};

const isBreachRecordArray = (value: unknown): value is BreachRecord[] =>
	Array.isArray(value) && value.every(isBreachRecord);

const checkEmailBreaches = async (
	email: string,
	apiKey: string,
	truncate: boolean
) => {
	const url = `${HIBP_BREACHED_ACCOUNT_URL}${encodeURIComponent(email)}?truncateResponse=${truncate ? 'true' : 'false'}`;
	const response = await fetch(url, {
		headers: {
			'hibp-api-key': apiKey,
			'user-agent': HIBP_USER_AGENT
		}
	});
	if (response.status === HIBP_NOT_FOUND) return [];
	if (response.status === HIBP_RATE_LIMITED) {
		const retryAfter = Number(response.headers.get('retry-after') ?? '0');
		if (retryAfter > 0) await sleep(retryAfter * MS_PER_SECOND);

		return [];
	}
	if (!response.ok) return [];

	const body: unknown = await response.json();
	if (!isBreachRecordArray(body)) return [];

	return body;
};

const scanEmail = async (
	email: string,
	apiKey: string,
	truncate: boolean,
	onBreachFound: EmailBreachScanInput['onBreachFound']
) => {
	const breaches = await checkEmailBreaches(email, apiKey, truncate);
	if (breaches.length === 0) return false;
	await onBreachFound({ breaches, email });

	return true;
};

type ScanPageOptions = {
	apiKey: string;
	emails: string[];
	onBreachFound: EmailBreachScanInput['onBreachFound'];
	pauseMs: number;
	truncate: boolean;
};

const scanPage = async (options: ScanPageOptions) => {
	let scanned = 0;
	let breached = 0;
	for (const email of options.emails) {
		scanned += 1;
		// eslint-disable-next-line no-await-in-loop -- HIBP rate-limit gate enforces serial requests
		const hit = await scanEmail(
			email,
			options.apiKey,
			options.truncate,
			options.onBreachFound
		);
		if (hit) breached += 1;
		// eslint-disable-next-line no-await-in-loop -- sleep is the rate-limit; awaiting it is the entire point
		await sleep(options.pauseMs);
	}

	return { breached, scanned };
};

export const runEmailBreachScan = async (input: EmailBreachScanInput) => {
	const pauseMs = input.pauseMs ?? DEFAULT_PAUSE_MS;
	const truncate = input.truncateResponse ?? true;
	let scanned = 0;
	let breached = 0;
	let cursor: string | undefined;

	do {
		// eslint-disable-next-line no-await-in-loop -- pager is intentionally serial; consumer controls batch size
		const page = await input.iterateEmails(cursor);
		// eslint-disable-next-line no-await-in-loop -- one page at a time keeps memory and rate-limit predictable
		const tally = await scanPage({
			apiKey: input.hibpApiKey,
			emails: page.emails,
			onBreachFound: input.onBreachFound,
			pauseMs,
			truncate
		});
		scanned += tally.scanned;
		breached += tally.breached;
		cursor = page.nextCursor;
	} while (cursor !== undefined);

	const result: EmailBreachScanResult = { breached, scanned };

	return result;
};

export type InactiveUserCandidate = {
	// `null` means "never logged in" — counted as inactive iff the user is older than the
	// threshold (we compare against `createdAt` instead, when present).
	createdAt?: number;
	lastLoginAt: number | null;
	userId: string;
};

export type PruneInactiveUsersInput = {
	dryRun?: boolean;
	// Same shape as EmailBreachScanInput: cursor in, page + next cursor out.
	iterateUsers: (cursor: string | undefined) => Promise<{
		nextCursor: string | undefined;
		users: InactiveUserCandidate[];
	}>;
	now?: () => number;
	olderThanDays: number;
	// Called for each user that crosses the threshold. The consumer decides what "prune"
	// means (soft delete, hard delete, disable + notify). Skipped in dryRun mode.
	onDelete: (userId: string) => Promise<void> | void;
};

export type PruneInactiveUsersResult = {
	dryRun: boolean;
	prunedUserIds: string[];
	scanned: number;
};

const pruneCandidate = async (
	candidate: InactiveUserCandidate,
	cutoff: number,
	dryRun: boolean,
	onDelete: PruneInactiveUsersInput['onDelete']
) => {
	const reference = candidate.lastLoginAt ?? candidate.createdAt;
	if (reference === undefined || reference === null) return false;
	if (reference >= cutoff) return false;
	if (!dryRun) await onDelete(candidate.userId);

	return true;
};

type PrunePageOptions = {
	candidates: InactiveUserCandidate[];
	cutoff: number;
	dryRun: boolean;
	onDelete: PruneInactiveUsersInput['onDelete'];
};

const prunePage = async (options: PrunePageOptions) => {
	const pruned: string[] = [];
	for (const candidate of options.candidates) {
		// eslint-disable-next-line no-await-in-loop -- deletes are sequential by design (predictable ordering, kinder to downstream stores)
		const removed = await pruneCandidate(
			candidate,
			options.cutoff,
			options.dryRun,
			options.onDelete
		);
		if (removed) pruned.push(candidate.userId);
	}

	return pruned;
};

export const pruneInactiveUsers = async (input: PruneInactiveUsersInput) => {
	const now = input.now?.() ?? Date.now();
	const thresholdMs = input.olderThanDays * MS_PER_DAY;
	const cutoff = now - thresholdMs;
	const dryRun = input.dryRun ?? false;
	const prunedUserIds: string[] = [];
	let scanned = 0;
	let cursor: string | undefined;

	do {
		// eslint-disable-next-line no-await-in-loop -- serial paging; the consumer controls batch size
		const page = await input.iterateUsers(cursor);
		scanned += page.users.length;
		// eslint-disable-next-line no-await-in-loop -- one page at a time so memory & DB pressure stay bounded
		const removed = await prunePage({
			candidates: page.users,
			cutoff,
			dryRun,
			onDelete: input.onDelete
		});
		prunedUserIds.push(...removed);
		cursor = page.nextCursor;
	} while (cursor !== undefined);

	const result: PruneInactiveUsersResult = { dryRun, prunedUserIds, scanned };

	return result;
};
