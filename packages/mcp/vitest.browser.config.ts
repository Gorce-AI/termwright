import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Real-browser monitor tests live outside the default suite so a bare checkout
 * does not need a downloaded Playwright browser. CI runs this lane explicitly
 * after installing Chromium.
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
    include: ['packages/mcp/src/**/*.e2e.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
