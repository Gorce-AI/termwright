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
    name: 'terminal-lifecycle-soak',
    include: ['quality/soak/terminal-cycle.test.ts'],
    environment: 'node',
    retry: 0,
  },
});
