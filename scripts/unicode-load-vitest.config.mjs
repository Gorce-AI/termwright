import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/unicode-load-probe.test.mjs'],
    pool: process.env.TERMWRIGHT_UNICODE_POOL ?? 'forks',
    maxWorkers: 1,
    retry: 0,
    experimental: {
      viteModuleRunner: process.env.TERMWRIGHT_UNICODE_VITE_RUNNER !== 'off',
    },
  },
});
