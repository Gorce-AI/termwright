import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `.case.mjs` keeps this deliberately failing upstream control out of the
    // repository-wide Vitest catalogue. It is executed only by the isolated
    // matrix, which classifies the known upstream failure as evidence.
    include: ['scripts/unicode-load-probe.case.mjs'],
    pool: process.env.TERMWRIGHT_UNICODE_POOL ?? 'forks',
    maxWorkers: 1,
    retry: 0,
    experimental: {
      viteModuleRunner: process.env.TERMWRIGHT_UNICODE_VITE_RUNNER !== 'off',
    },
  },
});
