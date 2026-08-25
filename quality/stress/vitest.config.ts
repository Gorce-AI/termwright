import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@termwright\/test$/u,
        replacement: fileURLToPath(new URL('../../packages/test/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    name: 'terminal-concurrency-stress',
    include: ['quality/stress/terminal-concurrency.test.ts'],
    environment: 'node',
    retry: 0,
  },
});
