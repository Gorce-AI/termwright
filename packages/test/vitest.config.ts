import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Sibling workspace packages resolve from source: the preset is developed
 * alongside the driver and trace packages, and waiting for their `dist/` would
 * make every change a two-step build.
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
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
