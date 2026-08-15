import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Sibling packages resolve from source: `dist/` lags while the monorepo is being
 * built out, and these tests read real `.twtrace` archives written by the trace
 * writer they are testing against.
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
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
