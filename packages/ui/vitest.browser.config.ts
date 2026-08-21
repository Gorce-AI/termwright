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
    alias: [
      { find: /^@termwright\/driver$/u, replacement: fileURLToPath(new URL('../driver/src/index.ts', import.meta.url)) },
      { find: /^@termwright\/protocol$/u, replacement: fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)) },
      { find: /^@termwright\/protocol\/contract$/u, replacement: fileURLToPath(new URL('../protocol/src/contract.ts', import.meta.url)) },
      { find: /^@termwright\/protocol\/action-model$/u, replacement: fileURLToPath(new URL('../protocol/src/action-model.ts', import.meta.url)) },
      { find: /^@termwright\/trace$/u, replacement: fileURLToPath(new URL('../trace/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['src/app/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One browser, one server per test: parallel pages would race on the
    // ephemeral ports and make a failure hard to attribute.
    fileParallelism: false,
  },
});
