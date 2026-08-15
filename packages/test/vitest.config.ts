import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Sibling workspace packages resolve from source: the preset is developed
 * alongside the driver and trace packages, and waiting for their `dist/` would
 * make every change a two-step build.
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
  },
});
