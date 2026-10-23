import { expect, test } from 'bun:test';
import { MAX_IMPERSONATION_REASON_LENGTH, MIN_IMPERSONATION_REASON_LENGTH } from '../src/client';

test('the client entry exposes shared impersonation limits without server-only imports', async () => {
 expect(MIN_IMPERSONATION_REASON_LENGTH).toBeGreaterThan(0);
 expect(MAX_IMPERSONATION_REASON_LENGTH).toBeGreaterThan(MIN_IMPERSONATION_REASON_LENGTH);
 const build = await Bun.build({
  entrypoints: [new URL('../src/client/index.ts', import.meta.url).pathname],
  target: 'browser'
 });
 expect(build.success).toBe(true);
 expect(build.logs).toEqual([]);
});
