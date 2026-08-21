import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // This package launches real Node processes through ConPTY. The complete
    // workspace suite already runs packages concurrently, and unconstrained
    // file workers can starve those child processes on GitHub's Windows VM.
    // Keep every test enabled while giving process startup a realistic budget.
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
