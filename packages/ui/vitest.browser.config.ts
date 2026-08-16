import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The browser end-to-end lane. Separate from `vitest.config.ts` because it
 * needs a built `dist/app` and an installed Chromium, which the unit suites do
 * not — `pnpm test` must stay runnable on a bare checkout.
 *
 * `*.e2e.ts` rather than `*.test.ts` so the default config cannot pick these up
 * by accident.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@termwright/driver': fileURLToPath(new URL('../driver/src/index.ts', import.meta.url)),
      '@termwright/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
      '@termwright/trace': fileURLToPath(new URL('../trace/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One browser, one server per test: parallel pages would race on the
    // ephemeral ports and make a failure hard to attribute.
    fileParallelism: false,
  },
});
