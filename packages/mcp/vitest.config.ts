import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Sibling workspace packages resolve from source: `dist/` may lag while the
 * driver is still being built out, and the end-to-end tests drive the real
 * driver against the fixtures in `packages/driver/test-fixtures`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@termwright/driver': fileURLToPath(new URL('../driver/src/index.ts', import.meta.url)),
      '@termwright/protocol': fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
