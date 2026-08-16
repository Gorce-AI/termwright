import { defineConfig } from 'vitest/config';

/**
 * Hostile-input configuration: the whole suite runs in a forked worker whose
 * old-space is capped at 128 MB, per the engineering baseline in CONTRACTS.md.
 * Setting `execArgv` on the pool is what actually constrains the worker —
 * NODE_OPTIONS alone only constrains the launcher.
 */
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        execArgv: ['--max-old-space-size=128'],
        singleFork: true,
      },
    },
  },
});
