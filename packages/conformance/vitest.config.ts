import { defineConfig } from 'vitest/config';

/**
 * Conformance suites drive real child processes over real pseudo-terminals, so
 * they are slower and far more timing-sensitive than unit tests. Each suite
 * gets its own fork: a wedged fixture can then only take its own file down.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Fixtures bind unix sockets and spawn PTYs; running files in parallel
    // multiplies both without making the suite meaningfully faster.
    fileParallelism: false,
  },
});
