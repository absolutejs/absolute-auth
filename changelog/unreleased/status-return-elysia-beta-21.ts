import type { Change } from '@absolutejs/changelog';

export const change: Change = {
	detail: "`StatusReturn` picked `code` from Elysia's `ElysiaStatus`, which Elysia 2.0.0-beta.21 removed (the status box now carries `status` and `response`). Every `status(...)` returned from an auth callback was a type error on that Elysia. `StatusReturn` now picks `status` and `response`, which every Elysia 2 beta has. Runtime behavior is unchanged. Also shipped as 0.85.1 for consumers pinned to 0.85.",
	kind: 'fixed',
	summary: 'Auth callbacks can return `status(...)` on Elysia 2.0.0-beta.21',
	symbols: ['StatusReturn']
};
