import { defineConfig } from 'vitest/config';

/**
 * Hostile-input configuration, mirroring `@termwright/protocol`: the worker's
 * old space is capped at 128 MB per the engineering baseline in CONTRACTS.md,
 * so a resource-exhaustion case fails closed instead of passing by virtue of a
 * large default heap. Setting `execArgv` on the pool is what constrains the
 * worker — NODE_OPTIONS alone only constrains the launcher.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--max-old-space-size=128'],
        singleFork: true,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
