import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Sibling packages resolve from source: `dist/` lags while the monorepo is being
 * built out, and these tests read real `.twtrace` archives written by the trace
 * writer they are testing against.
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@termwright/protocol/contract',
        replacement: fileURLToPath(new URL('../protocol/src/contract.ts', import.meta.url)),
      },
      {
        find: '@termwright/protocol/action-model',
        replacement: fileURLToPath(new URL('../protocol/src/action-model.ts', import.meta.url)),
      },
      {
        find: /^@termwright\/driver\/experimental$/u,
        replacement: fileURLToPath(new URL('../driver/src/experimental.ts', import.meta.url)),
      },
      {
        find: /^@termwright\/driver$/u,
        replacement: fileURLToPath(new URL('../driver/src/index.ts', import.meta.url)),
      },
      {
        find: /^@termwright\/protocol$/u,
        replacement: fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
      },
      {
        find: /^@termwright\/protocol\/contract$/u,
        replacement: fileURLToPath(new URL('../protocol/src/contract.ts', import.meta.url)),
      },
      {
        find: /^@termwright\/protocol\/action-model$/u,
        replacement: fileURLToPath(new URL('../protocol/src/action-model.ts', import.meta.url)),
      },
      {
        find: '@termwright/trace',
        replacement: fileURLToPath(new URL('../trace/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
