import type * as Api from '../../src/index';
import type { Change } from '@absolutejs/changelog';

export const change: Change<typeof Api> = {
	kind: 'fixed',
	summary:
		'docs/PERSISTENT-CREDENTIALS.md no longer mixes SQLite and PostgreSQL or gives stale migration advice: it has one complete PostgreSQL + Drizzle path and one SQLite path, the exact route list and session cookie, a typed guard, and current migration steps, and its code is typechecked against dist (check:guide) and run end to end in tests.'
};
