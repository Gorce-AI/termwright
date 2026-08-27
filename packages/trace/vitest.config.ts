import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Sibling workspace packages are resolved from source: `dist/` may not exist
 * while the driver and protocol packages are still being built out, and trace
 * only ever imports types from them.
 */
export default defineConfig({
  resolve: {
    alias: [
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
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
