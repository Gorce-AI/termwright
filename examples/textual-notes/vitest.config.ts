import { defineConfig } from 'vitest/config';
// The reporter comes from the subpath: this file is loaded before the test
// runner exists, and the package root registers matchers on `expect`.
import TermwrightReporter from 'termwright/reporter';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['default', new TermwrightReporter()],
  },
});
