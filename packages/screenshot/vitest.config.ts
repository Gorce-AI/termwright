import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** The driver is a type-only dependency here; the alias keeps tests off `dist/`. */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@termwright\/driver\/experimental$/u,
        replacement: fileURLToPath(new URL('../driver/src/experimental.ts', import.meta.url)),
      },
      {
        find: /^@termwright\/driver$/u,
        replacement: fileURLToPath(new URL('../driver/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
